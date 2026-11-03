import type { ChatProgress } from "./types";

export const CHAT_MESSAGE_LIMIT = 8_000;

export function pastedMessageFits(input: string, paste: string, start: number, end: number) {
  return input.length - (end - start) + paste.length <= CHAT_MESSAGE_LIMIT;
}

type WorkspaceSignals = {
  restored: boolean; switching: boolean; busy: boolean; stopping: boolean;
  recovering: boolean; launchLocked: boolean; conflict: boolean; saveFailed: boolean;
  online: boolean; phase: ChatProgress & { type: "phase" };
};

/** The same status drives visible guidance, accessible output and submission. */
export function workspaceState(s: WorkspaceSignals) {
  if (s.stopping) return { id: "stopping", blocked: true, message: "Confirming your stop request…" };
  if (s.busy) return { id: s.phase.phase, blocked: true, message: {
    thinking: "Working on your idea…", reading: "Checking the details…",
    building: "Building your hook…", checking: "Checking your hook…", repairing: "Updating your hook…",
    reconnecting: "Reconnecting to your saved reply…",
  }[s.phase.phase] };
  if (s.recovering) return { id: "reconnecting", blocked: true, message: "Reconnecting to your saved reply…" };
  if (s.switching) return { id: "switching", blocked: true, message: "Opening your saved chat…" };
  if (!s.restored) return { id: "restoring", blocked: true, message: "Loading your saved draft…" };
  if (s.launchLocked) return { id: "launching", blocked: true, message: "Preparing your launch. Your saved rules stay here." };
  if (s.conflict) return { id: "conflict", blocked: true, message: "This draft changed in another window. Choose which version to keep below." };
  if (s.saveFailed) return { id: "save-error", blocked: true, message: "Your changes are on this device. Retry saving before sending." };
  if (!s.online) return { id: "offline", blocked: true, message: "You’re offline. Keep writing; reconnect before sending." };
  return { id: "ready", blocked: false, message: "Ready for your next message." };
}
