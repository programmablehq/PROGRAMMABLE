export type LaunchPreparation = { state: "needs-input" | "working" | "blocked" | "design-ready" | "ready";
  inputKey?: string; message: string; revision: string; expiresAt: number; ticket?: string };
export function designReadiness(input: { sourceHash?: string; checked: boolean; pendingChange?: string; name: string; symbol: string; image: boolean; connected: boolean }): LaunchPreparation {
  const revision = input.sourceHash ?? "";
  if (input.pendingChange) return { state: "blocked", message: "Finish your latest change before launching.", revision, expiresAt: 0 };
  if (!input.checked) return { state: "needs-input", message: "Describe your coin’s rules in the chat.", revision, expiresAt: 0 };
  if (!input.name.trim() || !input.symbol.trim() || !input.image) return { state: "needs-input", message: "Add your coin’s name, ticker and image.", revision, expiresAt: 0 };
  return { state: "design-ready", message: input.connected ? "Preparing your launch…" : "Design ready. Connect your wallet to launch.", revision, expiresAt: 0 };
}
