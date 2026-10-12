const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Display only. The authenticated service validates and stores the operator
 * report; this projection also prevents a different review's report displaying
 * as a pass while selecting or updating a review. */
export function customLaunchTradeEvidence(value: unknown, subjectHash?: string, chainId?: string) {
  const report = record(value);
  const checks = Array.isArray(report.checks) ? report.checks.map(record) : [];
  const bound = subjectHash !== undefined && chainId !== undefined
    && report.schemaVersion === "programmable.review-trade-report.v4"
    && report.scope === "operator-local-fork-exact-scenario" && report.mainnetTransactionsSent === false
    && report.subjectHash === subjectHash && report.chainId === chainId
    && checks.length === 2 && checks[0].side === "buy" && checks[1].side === "sell"
    && checks.every(check => ["passed", "failed"].includes(String(check.status)) && ["passed", "failed"].includes(String(record(check.fee).status)));
  const passed = bound && report.status === "passed" && checks.every(check => check.status === "passed" && record(check.fee).status === "passed");
  const failed = bound && report.status === "failed" && checks.some(check => check.status === "failed" || record(check.fee).status === "failed");
  const currentPlatformFee = passed && report.platformFeeBps === 30 && report.feeCollection === "pool"
    && report.feePolicyVersion === "programmable.custom-launch-pool-fee.v1"
    && report.digestEncoding === "canonical-json-v1";
  return { currentPlatformFee, status: passed ? "passed" : failed ? "failed" : "pending", report: passed || failed ? report : null } as const;
}
