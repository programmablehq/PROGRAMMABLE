const launchIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Ethereum graph handoffs omit chainId. Robinhood's Plan and V4 graph
 * handoffs declare 4663 explicitly; never reinterpret an Ethereum ID as V4. */
export function developerLaunchDestination(query: URLSearchParams): { launchId: string | null; chainId: "4663" | "8453" | "999" | null } {
  const candidate = query.get("launchId"), chainId = query.get("chainId");
  const validChain = chainId === null || ["1", "4663", "8453", "999"].includes(chainId);
  const launchId = candidate && launchIdPattern.test(candidate) && query.getAll("launchId").length === 1
    && query.getAll("chainId").length <= 1 && validChain ? candidate.toLowerCase() : null;
  return { launchId, chainId: chainId === "8453" || chainId === "999" ? chainId : chainId === "1" || launchId && chainId === null ? null : "4663" };
}

export function developerApiKeysInitialSection(
  searchParams: Record<string, string | string[] | undefined>,
) {
  return searchParams.view === "history" || searchParams.start === "custom"
    || typeof searchParams.launchId === "string" && launchIdPattern.test(searchParams.launchId)
    ? "history" as const
    : "keys" as const;
}
