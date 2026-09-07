"""Pause-aware background tool-write enforcement. No signing capability."""
from __future__ import annotations
import json
import threading
import httpx
from factguard import guard_text
from .guard_hook import build_sheet

WRITE_TOOLS = frozenset({'post_update', 'draft_bounty'})
JOBS = {
 'pulse': ('0 * * * *', 'Read get_entity_config and get_needs_snapshot. If there are no notable deltas, post_update kind pulse with snapshot_id and no text. Otherwise write a brief measured pulse and post it. Never recompute needs or invent measurements.'),
 'daily-reflection': ('30 6 * * *', 'Read get_entity_config, get_needs_snapshot and current public observations. Write a short reflection on measured changes and missing coverage, and post_update kind reflection. Describe uncertainty plainly.'),
 'weekly-bounties': ('0 9 * * 1', 'Read get_entity_config, get_strategy, get_needs_snapshot, get_attestation_summary and list_open_bounties. Draft up to three evidence-grounded, nonduplicate bounties using draft_bounty. Include measurable verification and a prediction for tier one. Do not propose unverifiable work or move money.'),
 'quarterly-strategy': ('0 9 1 1,4,7,10 *', 'Read get_entity_config, get_strategy, get_needs_snapshot, get_attestation_summary and list_open_bounties. Evaluate previous strategies and predictions against actual evidence. Post_update kind strategy with a revised, testable strategy and explicit uncertainty. Do not claim outcomes without attestations.'),
 'donor-report': ('0 9 1 * *', 'Read get_entity_config, get_strategy, get_needs_snapshot and get_attestation_summary. Post_update kind donor_report with one factual narrative paragraph about documented work and limitations. No urgency language or invented financial amounts.'),
}


def live_pause_check(slug, key, base='http://127.0.0.1:8001'):
    """Fail closed, including absent/malformed/sync-failed states."""
    try:
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            response=client.get(base+'/admin/state',headers={'X-Gate-Admin':key})
            response.raise_for_status()
            pause=response.json()['pause']
            return (pause.get('last_sync_ok') is not True or
                    pause.get('fail_closed_active') is not False or
                    not isinstance(pause.get('paused'),list) or slug in pause['paused'])
    except Exception:
        return True


class WriteGuard:
    """One isolated process/turn. A lock also protects parallel MCP completions."""
    def __init__(self, is_paused):
        self.is_paused=is_paused
        self.messages=[{'role':'user','content':'Run the scheduled ecological stewardship task.'}]
        self.lock=threading.Lock()
        self.writes=0
        self.held=0

    def observe(self, result):
        with self.lock:
            self.messages.append({'role':'tool','tool_call_id':f'observed-{len(self.messages)}',
                                  'content':json.dumps(result)})

    def permit(self, name, args):
        if name not in WRITE_TOOLS or self.is_paused():
            return False
        with self.lock:
            # Tool names/keys are protocol, but their values can be publishable claims.
            # No regeneration here: an ungrounded write is held before side effects.
            result=guard_text(json.dumps(args,ensure_ascii=False),build_sheet(self.messages))
            if not result.ok:
                self.held+=1
                return False
            self.writes+=1
            return True
