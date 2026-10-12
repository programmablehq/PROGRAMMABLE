/** Retry preparation reads/owner-start only. Never use this for wallet sends. */
export function preparationRetryDelayV1(status: number, retryAfter: string | null, attempt: number, now = Date.now()): number | null {
  if (![408, 429, 502, 503, 504].includes(status) || attempt >= 3) return null;
  const requested = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000
    : retryAfter ? Date.parse(retryAfter) - now : 0;
  if (requested > 2_147_483_647) return null;
  // Do not retry early when an upstream asks for a longer pause.
  return Math.max(3000 * attempt, Number.isFinite(requested) ? requested : 0);
}

export function waitForPreparationRetryV1(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
