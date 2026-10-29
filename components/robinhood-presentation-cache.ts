import {
  mergeRobinhoodPresentations,
  type RobinhoodCoinPresentation,
} from "@/lib/robinhood-presentation";

const MAX_ENTRIES = 64;
const MAX_AGE_MS = 900_000;
type Presentation = ReturnType<typeof mergeRobinhoodPresentations>;

function queryKey(query: string, chainId: 1 | 4663 | 8453 | 999) {
  const params = new URLSearchParams(query);
  for (const name of ["token", "account"]) {
    const value = params.get(name);
    if (value) params.set(name, value.toLowerCase());
  }
  params.sort();
  return `${chainId}:${params}`;
}

export function createRobinhoodPresentationCache() {
  const entries = new Map<string, { value: Presentation; savedAt: number }>();

  function read(query: string, now = Date.now(), chainId: 1 | 4663 | 8453 | 999 = 4663): Presentation | null {
    const key = queryKey(query, chainId);
    const saved = entries.get(key);
    if (!saved) return null;
    if (now < saved.savedAt || now - saved.savedAt >= MAX_AGE_MS) {
      entries.delete(key);
      return null;
    }
    // Reading metadata must not extend the age of its market observation.
    const current = mergeRobinhoodPresentations([], saved.value.items, now);
    return { ...current, delayed: saved.value.delayed || current.delayed };
  }

  function write(
    query: string,
    value: Presentation,
    now = Date.now(),
    chainId: 1 | 4663 | 8453 | 999 = 4663,
  ): Presentation {
    const key = queryKey(query, chainId);
    // The caller already merged the raw response. Merging again could treat a
    // rejected new pool's null market as permission to restore the previous pool.
    entries.delete(key);
    entries.set(key, { value, savedAt: now });
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    return value;
  }

  return { read, write };
}

// Public presentation data only. Server rendering neither reads nor writes it.
const browserCache = createRobinhoodPresentationCache();

export function readRememberedRobinhoodPresentation(query: string, chainId: 1 | 4663 | 8453 | 999 = 4663) {
  return typeof window === "undefined" ? null : browserCache.read(query, Date.now(), chainId);
}

export function rememberRobinhoodPresentation(
  query: string,
  value: Presentation,
  chainId: 1 | 4663 | 8453 | 999 = 4663,
) {
  if (typeof window !== "undefined") browserCache.write(query, value, Date.now(), chainId);
  return value;
}

export function rememberRobinhoodTokenPresentations(items: readonly RobinhoodCoinPresentation[]) {
  if (typeof window === "undefined") return;
  for (const item of items) browserCache.write(`token=${item.tokenAddress}`, { items: [item], delayed: false }, Date.now(), item.chainId ?? 4663);
}
