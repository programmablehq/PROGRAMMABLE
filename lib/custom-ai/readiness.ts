export type LaunchPreparation = { state: "needs-input" | "working" | "blocked" | "design-ready" | "ready";
  inputKey?: string; message: string; revision: string; expiresAt: number; ticket?: string;
  missingFields?: ("name" | "symbol" | "image")[] };
export function designReadiness(input: { sourceHash?: string; checked: boolean; hasDesign?: boolean; pendingChange?: string; pairPending?: boolean; openRequirements?: boolean; name: string; symbol: string; image: boolean; connected: boolean }): LaunchPreparation {
  const revision = input.sourceHash ?? "";
  if (input.pairPending) return { state: "blocked", message: "Finish the pair token address or select the native token.", revision, expiresAt: 0 };
  if (input.openRequirements) return { state: "blocked", message: "Resolve the open choices in the chat.", revision, expiresAt: 0 };
  if (input.pendingChange) return { state: "blocked", message: "Finish your latest change before launching.", revision, expiresAt: 0 };
  if (!input.checked) return { state: "needs-input", message: input.hasDesign?"Your rules are saved. Ask the chat to build your hook.":"Describe your coin’s rules in the chat.", revision, expiresAt: 0 };
  const missingFields: NonNullable<LaunchPreparation["missingFields"]> = [];
  if (!input.name.trim()) missingFields.push("name");
  if (!input.symbol.trim()) missingFields.push("symbol");
  if (!input.image) missingFields.push("image");
  if (missingFields.length) {
    const labels = missingFields.map(field => field === "symbol" ? "ticker" : field);
    const items = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
    return { state: "needs-input", message: `Add your coin’s ${items}.`, missingFields, revision, expiresAt: 0 };
  }
  return { state: "design-ready", message: input.connected ? "Ready to launch" : "Design ready. Connect your wallet to launch.", revision, expiresAt: 0 };
}
