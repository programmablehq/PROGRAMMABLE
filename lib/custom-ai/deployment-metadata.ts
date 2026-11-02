/** The canonical protected token takes its name and symbol from the selected
 * coin details. Test-fixture names must never become fixed launch metadata.
 * Only new declarations are normalized; saved proof identities remain intact. */
export function bindCanonicalTokenMetadata(value: unknown): { value: unknown; changed: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, changed: false };
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.targets)) return { value, changed: false };
  let changed = false;
  const targets = raw.targets.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const target = item as Record<string, unknown>, args = target.constructorArguments;
    if (target.source !== "src/launch-protection/ProtectedLaunchTokenV1.sol"
      || target.contract !== "ProtectedLaunchTokenV1" || !Array.isArray(args) || args.length !== 5) return item;
    const next = [...args];
    for (const [index, input] of [[0, "name"], [1, "symbol"]] as const) {
      if (typeof next[index] === "string") { next[index] = { input }; changed = true; }
    }
    return { ...target, constructorArguments: next };
  });
  return { value: changed ? { ...raw, targets } : value, changed };
}
