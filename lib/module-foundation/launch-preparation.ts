import { foundationReviewError, type FoundationLaunchDraft, type FoundationLaunchReview } from "./ui-types";
import { nativeCanonicalJson, nativeJson } from "../module-mode/native-catalog";
import { withFoundationReadDeadline } from "./read-deadline";

/** One exact draft, in this tab only. This cache never signs or submits a transaction. */
export class FoundationLaunchPreparation {
  private entry?: {
    key: string; controller: AbortController;
    promise: Promise<FoundationLaunchReview | null>; review?: FoundationLaunchReview | null;
  };

  invalidate(): void {
    this.entry?.controller.abort();
    this.entry = undefined;
  }

  prepare(draft: FoundationLaunchDraft, contextKey: string,
    prepare: (draft: FoundationLaunchDraft, signal: AbortSignal) => Promise<FoundationLaunchReview | null>): Promise<FoundationLaunchReview | null> {
    const key = `${contextKey}:${nativeCanonicalJson(nativeJson(draft))}`;
    const existing = this.entry;
    if (existing?.key === key && !existing.controller.signal.aborted
      // Leave time for the fresh wallet-bound checks instead of expiring halfway through opening the wallet.
      && (existing.review === undefined || (existing.review && !foundationReviewError(existing.review, contextKey, Date.now() + 15_000)))) return existing.promise;
    this.invalidate();
    const controller = new AbortController();
    const entry = { key, controller, promise: Promise.resolve(null) as Promise<FoundationLaunchReview | null>, review: undefined as FoundationLaunchReview | null | undefined };
    // Snapshot inputs before asynchronous work. Later edits cannot change the prepared transaction.
    const snapshot = structuredClone(draft);
    entry.promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return withFoundationReadDeadline(signal => prepare(snapshot, signal), 90_000, controller.signal);
    }).then(review => {
      controller.signal.throwIfAborted();
      if (this.entry !== entry) throw new Error("Your coin settings changed. Prepare the current draft again.");
      if (review) {
        const invalid = foundationReviewError(review, contextKey);
        if (invalid) throw new Error(invalid);
      }
      entry.review = review;
      return review;
    }).catch(error => {
      if (this.entry === entry) this.entry = undefined;
      throw error;
    });
    this.entry = entry;
    return entry.promise;
  }
}
