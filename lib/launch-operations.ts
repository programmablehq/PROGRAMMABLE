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
  status: string; next: string; owner: "Programmable" | "Team" | "Blockchain" | "None"; updatedAt: string | null;
  reviewId?: string; token?: string; transactionHash?: string | null;
};
export const operationIdentity = (row: Pick<OperationsLaunch, "chainId" | "token">) => `${row.chainId}:${row.token.toLowerCase()}`;
export function operationTokenHref(row: Pick<OperationsLaunch, "chainId" | "token">) {
  return `/token/${encodeURIComponent(row.token)}?chain=${row.chainId}`;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.slice(0, 200) : "";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function reviewOperations(review: Pick<CustomLaunchReview, "reviewId" | "chainId" | "subjectHash">, value: unknown) {
  const v = object(value), current = object(v.current);
  if (v.schemaVersion !== "programmable.custom-launch-review-operations.v1" || v.reviewId !== review.reviewId
    || v.chainId !== review.chainId || v.subjectHash !== review.subjectHash || typeof v.bindingsComplete !== "boolean"
    || !Array.isArray(v.boundLaunchIds) || v.boundLaunchIds.length > 128
    || !v.boundLaunchIds.every(id => typeof id === "string" && uuid.test(id))
    || (v.current !== null && (typeof current.launchId !== "string" || !v.boundLaunchIds.includes(current.launchId)
      || typeof current.replanRequired !== "boolean"))) return null;
  return { boundLaunchIds: v.boundLaunchIds as string[], current: v.current === null ? null : {
    launchId: current.launchId as string, status: text(current.status), stage: text(current.stage),
    errorCode: text(current.errorCode), replanRequired: current.replanRequired === true,
    updatedAt: typeof current.updatedAt === "string" && Number.isFinite(Date.parse(current.updatedAt)) ? current.updatedAt : null,
    findingCodes: Array.isArray(current.findingCodes) ? current.findingCodes.filter((code): code is string => typeof code === "string").slice(0, 256) : [],
  } };
}
export function reviewProject(review: OperationsReview) {
  const metadata = object(review.requestSummary.projectMetadata);
  const primary = object(metadata.token ?? metadata.primaryToken);
  const publication = object(review.requestSummary.publication);
  return { name: text(metadata.name) || text(primary.name) || text(publication.name) || `Request ${review.launchId.slice(0, 8)}`,
    symbol: text(metadata.symbol) || text(primary.symbol) || text(publication.symbol) };
}

/** Match exact request bindings, never the creator wallet or ticker. Approval alone is not a launch. */
export function buildOperationsRows(reviews: OperationsReview[], snapshot: OperationsSnapshot | null, now = Date.now()): OperationsRow[] {
  const indexed = new Map((snapshot?.indexed ?? []).map(row => [operationIdentity(row), row]));
  const published = snapshot?.published ?? [];
  const rows: OperationsRow[] = reviews.filter(review => !review.supersededBy).map(review => {
    const chainId = Number(review.chainId) as OperationsChain;
    const operations = reviewOperations(review, review.requestSummary.operations);
    const boundIds = new Set([review.launchId, ...operations?.boundLaunchIds ?? []]);
    const final = published.find(row => row.chainId === chainId && (boundIds.has(row.requestId ?? "")
      || boundIds.has(row.launchId) || (row.subjectHash && row.subjectHash === review.subjectHash)));
    const base = { id: `review:${review.reviewId}`, chainId, ...reviewProject(review), mode: "custom" as const,
      reviewId: review.reviewId, owner: "Programmable" as const, updatedAt: operations?.current?.updatedAt ?? review.launchRequestedAt ?? review.approvedAt ?? review.submittedAt };
    if (final) {
      const found = indexed.has(operationIdentity(final));
      return { ...base, token: final.token, transactionHash: final.transactionHash,
        group: found || !final.listed ? "complete" : "attention", status: found ? "Launched" : !final.listed ? "Launched · unlisted" : "Index not observed",
        owner: found || !final.listed ? "None" : "Programmable",
        next: found ? "Open the coin page." : !final.listed ? "Intentionally excluded from public discovery." : "A finalized launch is published. Check the website index." };
    }
    // A recorded transaction takes precedence over an expired approval or stale replan hint.
    const savedStatus = operations?.current?.status ?? "";
    if (["submitted", "broadcast", "mined", "sequencer_soft_confirmed", "ethereum_posted", "final", "finalized", "source_verified", "indexed", "publicly_visible"].includes(savedStatus)) {
      const progress = describeStoredLaunchStatus({}, operations);
      return { ...base, ...progress, group: progress.owner === "Blockchain" ? "waiting" : "attention" };
    }
    const label = customLaunchReviewLabel(review, now);
    if (review.state === "pending") {
      const waiting = review.discussion?.at(-1)?.author === "reviewer";
      return { ...base, group: waiting ? "waiting" : "review", status: waiting ? "Waiting for team reply" : customLaunchReviewOverdue(review, now) ? "Review overdue" : "Review pending",
        owner: waiting ? "Team" : "Programmable",
        next: waiting ? "The team needs to reply to the review feedback." : "Review the submitted contracts and decide." };
    }
    if (review.state === "rejected" || review.requiresRepack) return { ...base, group: "waiting", owner: "Team", status: label, next: "Read the review feedback, update the package and submit it again." };
    if (label === "Approval expired") return { ...base, group: "attention", status: "Window ended · launch unconfirmed", next: "Check launch status before offering another approval. An absent feed entry does not prove no transaction was sent." };
    if (operations?.current?.replanRequired) return { ...base, group: "waiting", owner: "Team", status: "Refresh launch preparation",
      next: "The team must replan with its own API key on the current release. The existing approval deadline still applies." };
    if (["authorized", "wallet_action_ready", "awaiting_wallet_signature", "wallet_action_required"].includes(savedStatus) || operations?.current?.stage === "router-transaction-required") return { ...base,
      group: "waiting", owner: "Team", status: "Ready · waiting for team signature", next: "The team should open this launch with its submitting wallet and sign within the approval window." };
    const started = review.launchRequestedAt ? Date.parse(review.launchRequestedAt) : null;
    if (started !== null && operations?.current) {
      const progress = describeStoredLaunchStatus({}, operations);
      const stale = now - Date.parse(operations.current.updatedAt ?? review.launchRequestedAt!) >= 15 * 60_000;
      return { ...base, ...progress, group: progress.owner === "Team" ? "waiting" : "attention",
        ...(stale && ["accepted", "analysis_pending", "prepared", "simulating", "validating", "reserved"].includes(savedStatus)
          ? { status: "Preparation needs checking", next: "Programmable needs to inspect the saved preparation. The team should keep this request; no new wallet signature is ready." } : {}) };
    }
    return { ...base, group: started !== null && now - started >= 15 * 60_000 ? "attention" : "waiting",
      owner: started === null ? "Team" : "Programmable",
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
      owner: "Programmable",
      token: row.token, transactionHash: row.transactionHash, updatedAt: row.observedAt,
      group: kind === "published" || age >= 15 * 60_000 ? "attention" : "waiting",
      status: !complete ? "Index observation incomplete" : kind === "recent" && age < 15 * 60_000 ? "Index pending" : "Index not observed",
      next: kind === "recent" ? "Receipt recorded. Check finality, stamp and index before retrying the launch." : "Finalized launch published. Check the website index and its latest source checkpoint." });
  }
  const rank = { attention: 0, review: 1, waiting: 2, complete: 3 };
  return rows.sort((a, b) => rank[a.group] - rank[b.group] || Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? "") || a.id.localeCompare(b.id));
}

/** Stored status is diagnostic only; never changes approval or authorizes a new transaction. */
export function describeStoredLaunchStatus(value: unknown, operations?: ReturnType<typeof reviewOperations>): Pick<OperationsRow, "status" | "next" | "owner"> {
  if (operations?.current) value = { ...operations.current, result: { stage: operations.current.stage } };
  const record = object(value), result = object(record.result), preflight = object(record.preflight);
  const status = text(record.status) || "not recorded";
  const codes = [text(record.errorCode), ...Array.isArray(record.findingCodes) ? record.findingCodes.map(text) : [],
    ...Array.isArray(preflight.findings) ? preflight.findings.map(finding => text(object(finding).code)) : []].filter(Boolean);
  const stage = text(result.stage) || text(preflight.status);
  if (["final", "finalized", "source_verified", "indexed", "publicly_visible"].includes(status)) return { owner: "Programmable", status: "Onchain complete · check index", next: "The saved launch is complete onchain. Check its public feed and website index; do not launch again." };
  if (["submitted", "broadcast", "mined", "sequencer_soft_confirmed", "ethereum_posted"].includes(status)) return { owner: "Blockchain", status: "Waiting for confirmation", next: "Track the recorded transaction before sending anything else. No new launch or approval is needed." };
  if (operations?.current?.replanRequired) return { owner: "Team", status: "Refresh launch preparation",
    next: "Replan with the team's own API key and current bindings. Keep all completed transactions. The existing approval deadline still applies." };
  if (codes.some(code => /(?:PROVIDER|COMPILER)_UNAVAILABLE|ADMISSION_PENDING/u.test(code))) return { owner: "Programmable", status: "Waiting for Programmable preparation", next: "Check the compiler, simulation or permit service. The team should keep this request and poll its status." };
  if (["authorized", "wallet_action_ready", "awaiting_wallet_signature", "wallet_action_required"].includes(status) || stage === "router-transaction-required") return { owner: "Team", status: "Ready · waiting for team signature", next: "Open the current launch with the submitting wallet and sign within its approval window." };
  if (["accepted", "analysis_pending", "prepared", "simulating", "validating", "reserved", "preflight_complete"].includes(status)) return { owner: "Programmable", status: "Preparing launch", next: "Programmable is checking the launch and preparing its wallet transaction. Keep this request; no signature is ready yet." };
  if (["failed", "cancelled", "expired", "action_required"].includes(status)) return { owner: "Team", status: "Launch needs attention", next: "Read the current finding and its repair instructions. Reconcile any wallet transaction before preparing a replacement." };
  return { owner: "Programmable", status: "Status needs checking", next: "Refresh this request and inspect its saved progress before asking the team to retry." };
}
