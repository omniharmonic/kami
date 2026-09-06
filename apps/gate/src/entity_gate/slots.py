"""Per-entity concurrency: an asyncio semaphore per slug plus a bounded wait queue.

When the queue is full the caller gets ``QueueFull(people_ahead=n)`` → HTTP 429
``{"people_ahead": n}`` (the web app renders "N people ahead").
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass


class QueueFull(Exception):
    def __init__(self, people_ahead: int) -> None:
        super().__init__(f"queue full; {people_ahead} people ahead")
        self.people_ahead = people_ahead


@dataclass
class _Lane:
    sem: asyncio.Semaphore
    active: int = 0
    waiting: int = 0


class Slot:
    def __init__(self, manager: SlotManager, slug: str) -> None:
        self._m = manager
        self.slug = slug
        self._released = False

    def release(self) -> None:
        if not self._released:
            self._released = True
            self._m._release(self.slug)


class SlotManager:
    def __init__(self, per_entity: int = 2, queue: int = 8) -> None:
        self.per_entity = max(1, per_entity)
        self.queue = max(0, queue)
        self._lanes: dict[str, _Lane] = {}

    def _lane(self, slug: str) -> _Lane:
        lane = self._lanes.get(slug)
        if lane is None:
            lane = self._lanes[slug] = _Lane(asyncio.Semaphore(self.per_entity))
        return lane

    def people_ahead(self, slug: str) -> int:
        lane = self._lane(slug)
        return lane.active + lane.waiting

    async def acquire(self, slug: str) -> Slot:
        lane = self._lane(slug)
        if lane.active >= self.per_entity and lane.waiting >= self.queue:
            raise QueueFull(lane.active + lane.waiting)
        lane.waiting += 1
        try:
            await lane.sem.acquire()
        finally:
            lane.waiting -= 1
        lane.active += 1
        return Slot(self, slug)

    def _release(self, slug: str) -> None:
        lane = self._lane(slug)
        lane.active = max(0, lane.active - 1)
        lane.sem.release()

    def state(self) -> dict[str, dict[str, int]]:
        return {slug: {"active": lane.active, "waiting": lane.waiting}
                for slug, lane in self._lanes.items()}
