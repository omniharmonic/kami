import type { HealthSnapshot } from "@kami/needs";

/** Playful delivery, literal state: never invent an ecological observation. */
export function habitatPhrase(snapshot: HealthSnapshot | null, paused: boolean): string {
  if (paused) return "A little rest. My agent is paused.";
  if (snapshot?.paused) return "My agent has resumed. Waiting for a fresh health snapshot.";
  if (!snapshot) return "Listening for my first field notes…";
  if (snapshot.stale_driving) return "Some of my senses need a fresh field note.";
  if (!snapshot.gpu_online) return "My field notes are here. My agent is resting.";
  return snapshot.mood_reason;
}

export const habitatCopy = {
  title: "Field journal",
  senses: "Senses",
  chat: "Chat",
  plans: "Strategies",
  projects: "Projects",
  treasury: "Treasury",
  community: "Community",
  evidence: "Evidence",
};
