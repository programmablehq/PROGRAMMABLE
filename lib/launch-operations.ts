import { customLaunchReviewLabel, customLaunchReviewOverdue, type CustomLaunchReview } from "./custom-launch-review";

export type OperationsChain = 1 | 4663;
export type ObservationStatus = "ready" | "syncing" | "stale" | "partial" | "unavailable";
export type OperationsLaunch = {
  chainId: OperationsChain;
  token: string;
  name: string;
  symbol: string;
  mode: "module" | "custom" | "classic";
  launchId: string;
  requestId?: string;
  subjectHash?: string;
  transactionHash: string | null;
  observedAt: string | null;
  stamp: "recorded" | "native-source" | "not-checked";
  listed: boolean;
};
export type OperationsSource = { id: string; label: string; chainId: OperationsChain | null; status: ObservationStatus; updatedAt: string | null; count: number; complete: boolean };
export type OperationsSnapshot = {
  schemaVersion: "programmable.launch-operations.v1";
  checkedAt: string;
  sources: OperationsSource[];
  indexed: OperationsLaunch[];
  published: OperationsLaunch[];
  recent: OperationsLaunch[];
};
export type OperationsReview = CustomLaunchReview & { launchId: string; requestSummary: Record<string, unknown> };
export type OperationsRow = {
  id: string; chainId: OperationsChain; name: string; symbol: string; mode: "module" | "custom" | "classic";
  group: "review" | "waiting" | "attention" | "complete";
  status: string; next: string; updatedAt: string | null;
  reviewId?: string; token?: string; transactionHash?: string | null;
};
export const operationIdentity = (row: Pick<OperationsLaunch, "chainId" | "token">) => `${row.chainId}:${row.token.toLowerCase()}`;
export function operationTokenHref(row: Pick<OperationsLaunch, "chainId" | "token">) {
  return `/token/${encodeURIComponent(row.token)}?chain=${row.chainId}`;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.slice(0, 200) : "";
export function reviewProject(review: OperationsReview) {
  const metadata = object(review.requestSummary.projectMetadata);
  const primary = object(metadata.token ?? metadata.primaryToken);
  return { name: text(metadata.name) || text(primary.name) || `Request ${review.launchId.slice(0, 8)}`, symbol: text(metadata.symbol) || text(primary.symbol) };
}

/** Match exact request bindings, never the creator wallet or ticker. Approval alone is not a launch. */
export function buildOperationsRows(reviews: OperationsReview[], snapshot: OperationsSnapshot | null, now = Date.now()): OperationsRow[] {
  const indexed = new Map((snapshot?.indexed ?? []).map(row => [operationIdentity(row), row]));
  const published = snapshot?.published ?? [];
  const rows: OperationsRow[] = reviews.filter(review => !review.supersededBy).map(review => {
    const chainId = Number(review.chainId) as OperationsChain;
    const final = published.find(row => row.chainId === chainId && (row.requestId === review.launchId
      || row.launchId === review.launchId || (row.subjectHash && row.subjectHash === review.subjectHash)));
    const base = { id: `review:${review.reviewId}`, chainId, ...reviewProject(review), mode: "custom" as const,
      reviewId: review.reviewId, updatedAt: review.launchRequestedAt ?? review.approvedAt ?? review.submittedAt };
    if (final) {
      const found = indexed.has(operationIdentity(final));
      return { ...base, token: final.token, transactionHash: final.transactionHash,
        group: found || !final.listed ? "complete" : "attention", status: found ? "Launched" : !final.listed ? "Launched · unlisted" : "Index not observed",
        next: found ? "Open the coin page." : !final.listed ? "Intentionally excluded from public discovery." : "A finalized launch is published. Check the website index." };
    }
    const label = customLaunchReviewLabel(review, now);
    if (review.state === "pending") {
      const waiting = review.discussion?.at(-1)?.author === "reviewer";
      return { ...base, group: waiting ? "waiting" : "review", status: waiting ? "Waiting for team reply" : customLaunchReviewOverdue(review, now) ? "Review overdue" : "Review pending",
        next: waiting ? "The team needs to reply to the review feedback." : "Review the submitted contracts and decide." };
    }
    if (review.state === "rejected" || review.requiresRepack) return { ...base, group: "waiting", status: label, next: "The team needs to update its submission." };
    if (label === "Approval expired") return { ...base, group: "waiting", status: "Window ended · launch unconfirmed", next: "Check launch status before offering another approval. An absent feed entry does not prove no transaction was sent." };
    const started = review.launchRequestedAt ? Date.parse(review.launchRequestedAt) : null;
    return { ...base, group: started !== null && now - started >= 15 * 60_000 ? "attention" : "waiting",
      status: started === null ? "Approved · waiting for team" : "Launch completion unconfirmed",
      next: started === null ? "The team can launch within its 24-hour approval window." : "Check the saved launch status. It may be waiting for signing, confirmation or indexing; do not resend blindly." };
  });
  const observed = new Map<string, { row: OperationsLaunch; kind: "published" | "recent" }>();
  for (const row of published) observed.set(operationIdentity(row), { row, kind: "published" });
  for (const row of snapshot?.recent ?? []) if (!observed.has(operationIdentity(row))) observed.set(operationIdentity(row), { row, kind: "recent" });
  for (const [identity, { row, kind }] of observed) {
    if (!row.listed || indexed.has(identity) || rows.some(existing => existing.token?.toLowerCase() === row.token.toLowerCase() && existing.chainId === row.chainId)) continue;
    const source = snapshot?.sources.find(source => source.id === `index:${row.chainId}`);
    const complete = source?.status === "ready" && source.complete;
    const age = row.observedAt ? now - Date.parse(row.observedAt) : 0;
    rows.push({ id: `index:${identity}`, chainId: row.chainId, name: row.name, symbol: row.symbol, mode: row.mode,
      token: row.token, transactionHash: row.transactionHash, updatedAt: row.observedAt,
      group: kind === "published" || age >= 15 * 60_000 ? "attention" : "waiting",
      status: !complete ? "Index observation incomplete" : kind === "recent" && age < 15 * 60_000 ? "Index pending" : "Index not observed",
      next: kind === "recent" ? "Receipt recorded. Check finality, stamp and index before retrying the launch." : "Finalized launch published. Check the website index and its latest source checkpoint." });
  }
  const rank = { attention: 0, review: 1, waiting: 2, complete: 3 };
  return rows.sort((a, b) => rank[a.group] - rank[b.group] || Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? "") || a.id.localeCompare(b.id));
}

/** Stored status is diagnostic only; never changes approval or authorizes a new transaction. */
export function describeStoredLaunchStatus(value: unknown): { status: string; next: string } {
  const record = object(value), result = object(record.result), preflight = object(record.preflight);
  const status = text(record.status) || "not recorded";
  const code = text(record.errorCode);
  const stage = text(result.stage) || text(preflight.status);
  const next = /^(?:finalized|final)$/u.test(status) ? "Completion is recorded. Compare the public launch feed and website index."
    : /submitted|broadcast|mined/u.test(status) ? "A transaction is recorded. Check its confirmation before sending anything else."
      : /failed|cancelled|expired/u.test(status) ? "Inspect this request and its feedback before retrying."
        : /authorized|prepared|ready/u.test(status) ? "Check the team’s wallet and the active signing window."
          : "Open the review to inspect the saved request and the next required action.";
  return { status: [status, stage, code].filter(Boolean).join(" · "), next };
}
