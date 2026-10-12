import { customLaunchTradeEvidence } from "@/lib/custom-launch-trade-evidence";
import type { CustomLaunchReview } from "@/lib/custom-launch-review";

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function CustomLaunchAssessment({ value, admin = false, tradeChecks, subjectHash, chainId, review }: { value: unknown; admin?: boolean; tradeChecks?: unknown; subjectHash?: string; chainId?: string; review?: CustomLaunchReview }) {
  const a = record(value), timing = record(a.timing), fees = record(a.fees), trading = record(a.trading);
  const evidence = customLaunchTradeEvidence(tradeChecks ?? a.operatorTradeChecks, subjectHash, chainId);
  const preparation = record(a.preparation);
  const notes = Array.isArray(preparation.notes) ? preparation.notes.map(record).filter(note => typeof note.message === "string") : [];
  // Approval supplies review context, not proof that a particular purchase occurred.
  // Keep source heuristics available without presenting them as new blockers.
  const reviewed = review?.state === "approved" && !review.supersededBy
    && review.subjectHash === subjectHash && review.chainId === chainId;
  const deadlines = Array.isArray(timing.deadlines) ? timing.deadlines.map(record).filter(d => d.state !== "covers_window") : [];
  if (!Object.keys(a).length && !evidence.report) return null;
  return <section aria-label="Launch readiness">
    {notes.length ? <details open={!reviewed}><summary>{reviewed ? "Automated hints from before review" : "Before launch"}</summary>
      {reviewed ? <p>These source checks were recorded before approval. They are not a new rejection. Read the review decision for the checked launch behavior; current launch status determines the next step.</p> : null}
      {notes.map((note, i) => <div key={i}><p>{note.code === "INITIAL_BUY_NOT_ESTABLISHED"
        ? reviewed ? "The source check could not identify the initial buy automatically. See the review decision for its execution results."
          : "Initial buy needs review: identify the purchase call and its input and output in the launch simulation."
        : String(note.message)}</p>
        {admin && typeof note.location === "string" ? <small style={{ overflowWrap: "anywhere" }}>{note.location}</small> : null}
      </div>)}
      {!reviewed ? <p>These are preparation hints, not a review decision.</p> : null}
    </details> : null}
    {deadlines.length ? <div role="status"><strong>Embedded deadline needs attention</strong>
      {deadlines.map((d, i) => <p key={i}>{String(d.path)}: {d.state === "unknown_semantics" ? "may be a sentinel, duration or block number; confirm its meaning in the source" : d.state === "expired" ? "already expired" : "ends before the review and launch window"}{typeof d.expiresAt === "string" ? ` (${new Date(d.expiresAt).toLocaleString()})` : ""}.</p>)}
      {deadlines.some(d => d.state === "expired" || d.state === "short_window") ? <p>Approval cannot extend a deadline inside your contract call. Update it to cover review and launch, then submit the new request.</p> : <p>The argument name alone does not establish a time limit. Confirm its meaning in the contract source.</p>}
    </div> : null}
    {admin && a.timing === null ? <p>Embedded deadlines have not been checked. Inspect the initializer before approval.</p> : null}
    {Object.keys(fees).length ? <details><summary>Trading fees</summary>
      <p>Programmable route fee: <strong>{typeof fees.platformRoutedRateBps === "number" ? `${(fees.platformRoutedRateBps / 100).toFixed(2)}%` : "See the signed fee obligations"}</strong>.</p>
      {typeof fees.recipient === "string" ? <p>Recipient: <code style={{ overflowWrap: "anywhere" }}>{fees.recipient}</code></p> : null}
      {typeof fees.buyBasis === "string" ? <p>Buy: {fees.buyBasis.replaceAll("-", " ")}. Sell: {String(fees.sellBasis).replaceAll("-", " ")}. Currency: {String(fees.currency)}.</p> : null}
      <p>Custom hook and pool fees may be additional. The full combined fee is not established here. A hook fee only replaces the route fee after the route verifies it.</p>
    </details> : null}
    {admin && (Object.keys(trading).length > 0 || evidence.report) ? <details open><summary>Trading checks</summary>
      <p role="status">{evidence.status === "passed" ? "Passed on fork: buy, sell and the bound platform fee collection." : evidence.status === "failed" ? "Fork check failed. Review the results before approval." : "Buy, sell and platform fee checks are pending for this version."}</p>
      {evidence.report ? <>
        <p>Checked for this exact launch on {chainId === "1" ? "Ethereum" : "Robinhood"}, block {String(evidence.report.forkBlockNumber)}. This records the tested scenario; live execution is checked separately.</p>
        <details><summary>Fork check results</summary><pre>{JSON.stringify(evidence.report, null, 2)}</pre></details>
      </> : <p>A launch simulation or approval alone does not verify trading.</p>}
      {trading.evidence ? <details><summary>Recorded behavior evidence</summary><pre>{JSON.stringify(trading.evidence, null, 2)}</pre></details> : null}
    </details> : null}
  </section>;
}
