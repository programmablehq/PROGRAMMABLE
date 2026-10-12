/** Only bounded diagnostic identifiers are copied. Never copy response bodies or credentials. */
export function safeDeveloperDetails(message: string, chainId?: string) {
  const requestId = message.match(/(?:request[ _-]?id[\s:]+)([a-zA-Z0-9._:-]{1,128})/iu)?.[1]?.replace(/\.$/u, "");
  const httpStatus = message.match(/\bHTTP[ _](\d{3})\b/u)?.[1];
  const code = message.match(/\b(?:PLAN|API|API_KEY|CUSTOM_LAUNCH|LAUNCH_PLAN|HTTP|AUTH)_[A-Z0-9_]{2,96}\b/u)?.[0];
  return ["Programmable developer access", chainId ? `Chain: ${chainId}` : null,
    requestId && !requestId.startsWith("pm_live_") ? `Request ID: ${requestId}` : null, code ? `Code: ${code}` : null, httpStatus ? `HTTP: ${httpStatus}` : null].filter(Boolean).join("\n");
}
export function developerRecovery(message: string) {
  if (/API_KEY_(?:INACTIVE|NOT_FOUND|CHAIN_RESTRICTION)|scope|permission/iu.test(message)) return {
    owner: "Your action", title: "Check this key's access", action: "Try again",
    description: "Use an active key with the required permissions and saved chain access. Choosing a different builder chain does not change the key's permissions.", kind: "retry" as const };
  if (/401|403|sign.in|session|wallet|controller|permission|unauthor|forbidden/iu.test(message)) return {
    owner: "Your action", title: "Check your wallet connection", action: "Connect wallet",
    description: "Connect the wallet that created this request, then try again.", kind: "connect" as const };
  if (/429|rate.limit|too many|retry.after|seconds/iu.test(message)) return {
    owner: "Programmable", title: "Requests are temporarily limited", action: "Try again",
    description: "Your request is saved. Wait for the retry time before checking again.", kind: "retry" as const };
  return { owner: "Programmable", title: "We could not finish this check", action: "Try again",
    description: "Your existing keys and launches are kept. Retry here; if it continues, copy the details for support.", kind: "retry" as const };
}
