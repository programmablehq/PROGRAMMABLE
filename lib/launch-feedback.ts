export function launchFeedback(message:string) {
  if (/cancelled|canceled|user rejected|user denied|4001/i.test(message)) return "Wallet confirmation was cancelled. Choose Sign and launch when you’re ready to try again.";
  if (/allowance|token approval/i.test(message)) return "Confirm the required token authorization in your wallet, then continue with this launch.";
  if (/insufficient|not enough|balance.*(?:low|fund)|\bfunds\b/i.test(message)) return "Add enough ETH for the launch purchase and gas, then try again.";
  if (/interrupted|ambiguous|unknown.*(?:send|transaction)|missing.*(?:hash|response)/i.test(message)) return "Check the original transaction in your wallet. We’ll continue tracking it automatically.";
  if (/expired|deadline|validity/i.test(message)) return "This preparation has expired. Refresh the launch to check the latest preparation and approval.";
  if (/429|503|provider.*unavailable|temporarily|rate.limit/i.test(message)) return "The launch service is busy. Your request is saved. Keep this page open or refresh in a moment.";
  if (/wrong.*chain|chain.*(?:mismatch|changed)|switch.*chain/i.test(message)) return "Your wallet needs the chain shown above. Choose Sign and launch to switch and continue.";
  if (/binding|permit|authorization.*invalid|launch.*(?:changed|does not match)/i.test(message)) return "The prepared launch details need to be refreshed. Refresh this launch; if it continues, share the technical details with your bot or support.";
  if (/wallet|controller|401|403|session|sign.in/i.test(message)) return "Connect the wallet that submitted this launch, then refresh.";
  return "This step could not finish. Refresh your launch; if it continues, share the technical details below with your bot or support.";
}

/** Explain failures without inviting a second send when the first outcome is uncertain. */
export function foundationLaunchFeedback(error: unknown, stage: "details" | "image" | "simulation" | "wallet" | "result" = "details") {
  const value = error && typeof error === "object" ? error as { shortMessage?: unknown; message?: unknown; code?: unknown; cause?: unknown; walletRequestAttempted?: boolean; walletRequestRejected?: boolean } : {};
  const raw = typeof value.shortMessage === "string" ? value.shortMessage : typeof value.message === "string" ? value.message : "This step could not complete. Please try again.";
  let cause: unknown = error;
  const codes: number[] = [];
  for (let depth = 0; cause && typeof cause === "object" && depth < 8; depth++) {
    const nested = cause as { code?: unknown; cause?: unknown };
    if (nested.code !== undefined) codes.push(Number(nested.code));
    cause = nested.cause;
  }
  if (stage === "result") return "The transaction result could not be checked. Check your wallet activity; your transaction may already have been sent.";
  if (codes.includes(4001) || value.walletRequestRejected || /cancelled|canceled|user rejected|user denied/i.test(raw)) return "Wallet request cancelled. Your coin details are saved. Continue when you're ready.";
  if (codes.includes(-32002) || /request.*already pending|already.*wallet request/i.test(raw)) return "A request is already open in your wallet. Finish or cancel it there before continuing.";
  if (stage === "wallet" && value.walletRequestAttempted !== false) return "Check your wallet activity before trying again. This transaction may already have been sent; your coin details are saved.";
  if (/insufficient|not enough|balance.*(?:low|fund)/i.test(raw)) return "Not enough ETH for the first buy and network fees. Reduce your first buy or add ETH to this wallet.";
  if (/wrong.*(?:chain|network)|(?:chain|network).*(?:mismatch|changed)|switch.*(?:chain|network)/i.test(raw)) return "Your wallet is on a different network. Switch to the launch network shown above, then continue.";
  if (/expired|deadline|validity|launch.*(?:version|settings|details).*changed|release.*changed/i.test(raw)) return "The launch details need a fresh check. Choose Launch coin again; your entries are saved.";
  if (codes.some(code => [429, 503].includes(code)) || /RPC|HTTP request|fetch failed|failed to fetch|network request|timed? out|timeout|provider.*unavailable|rate.limit/i.test(raw)) return "The launch network could not be reached. Choose Launch coin to try again; your entries are saved.";
  if (stage === "image") return "The coin image could not be saved. Choose the image again; your other details are saved.";
  const message = raw.replace(/https?:\/\/[^\s"')]+/g, "[network]");
  if (message.length <= 320) return message;
  return stage === "simulation" ? "The launch checks could not finish. Your wallet has not opened. Choose Launch coin to try again; your entries are saved." : "The coin details could not be checked. Your entries are saved.";
}
