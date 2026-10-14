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
