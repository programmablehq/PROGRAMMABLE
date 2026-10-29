/** Reserve one slot for the oldest checkpoint; rotate the rest even if it fails. */
export function selectIndexLanes<T extends { releaseDigest: string }>(oldestFirst: readonly T[], slots: number, now: number): T[] {
  const count = Math.max(0, Math.min(oldestFirst.length, Math.floor(slots)));
  if (count === oldestFirst.length) return [...oldestFirst];
  if (count === 0) return [];
  const reserved = count > 1 ? [oldestFirst[0]] : [];
  const ring = oldestFirst.slice(reserved.length).sort((a, b) => a.releaseDigest.localeCompare(b.releaseDigest));
  const rotatingCount = count - reserved.length;
  const start = (Math.floor(now / 60_000) * rotatingCount) % ring.length;
  return [...reserved, ...Array.from({ length: rotatingCount }, (_, i) => ring[(start + i) % ring.length])];
}

/** Log transport diagnostics, never URLs, request bodies, headers or error messages. */
export function indexFailureDetails(error: unknown) {
  let current = error;
  let httpStatus: number | undefined, rpcCode: number | undefined, providerHost: string | undefined;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const item = current as Record<string, unknown>;
    if (typeof item.status === "number" && Number.isInteger(item.status) && item.status >= 100 && item.status <= 599) httpStatus ??= item.status;
    if (typeof item.code === "number" && Number.isSafeInteger(item.code)) rpcCode ??= item.code;
    if (typeof item.url === "string") {
      try {
        const host = new URL(item.url).hostname;
        if (/^(?:[a-z0-9-]+\.)*(?:alchemy\.com|quiknode\.pro|drpc\.live|drpc\.org|blockmachine\.io|chain\.robinhood\.com)$/u.test(host)) providerHost ??= host;
      } catch { /* Invalid URLs are not useful diagnostics. */ }
    }
    current = item.cause;
  }
  const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name) ? error.name : "unknown";
  return { errorName, ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(rpcCode === undefined ? {} : { rpcCode }), ...(providerHost ? { providerHost } : {}) };
}
