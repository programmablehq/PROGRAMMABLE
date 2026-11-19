import {containsInlineCredential} from "@/lib/custom-ai/platform/secret-input";
import type {ProjectRun} from "./types";

type ReloadEdit = {
  selected?: string;
  text: string;
  operation: ProjectRun["operation"];
  preview: boolean;
  savedAt: number;
};

export function saveReloadEdit(scope: string, edit: ReloadEdit) {
  try {
    // IndexedDB can close with the page before the pending edit commits.
    sessionStorage.setItem(scope + ":reload-edit", JSON.stringify(edit));
  } catch { /* Storage can be unavailable in this tab. */ }
}

export function readReloadEdit(scope: string, savedAt = 0): ReloadEdit | undefined {
  try {
    const raw = sessionStorage.getItem(scope + ":reload-edit");
    if (!raw) return;
    const edit = JSON.parse(raw);
    if (edit && Number.isFinite(edit.savedAt) && edit.savedAt > savedAt &&
        (edit.selected === undefined || typeof edit.selected === "string") &&
        typeof edit.text === "string" && edit.text.length <= 24000 && !containsInlineCredential(edit.text) &&
        ["build", "plan", "test", "deploy"].includes(edit.operation) && typeof edit.preview === "boolean") return edit;
  } catch { /* The durable workspace draft remains available. */ }
}

export function retireReloadEdit(scope: string, savedAt: number) {
  try {
    const key = scope + ":reload-edit";
    const raw = sessionStorage.getItem(key);
    if (raw && JSON.parse(raw)?.savedAt <= savedAt) sessionStorage.removeItem(key);
  } catch { /* A stale entry is also ignored on the next read. */ }
}
