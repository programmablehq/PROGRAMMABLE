import "server-only";

import { readEthereumExploreCatalog } from "./ethereum-explore";
import { readBaseExploreCatalog } from "./base-explore";
import { readRobinhoodExploreCatalog } from "./robinhood-index/read";

const CACHE_TTL_MS = 15_000;
const READ_TIMEOUT_MS = 5_000;
type IndexStatus = "ready" | "partial" | "syncing" | "stale" | "unavailable";
type IndexObservation = { status: IndexStatus; updatedAt: string | null };
type Readers = {
  ethereum: () => Promise<IndexObservation>;
  robinhood: () => Promise<IndexObservation>;
  base: () => Promise<IndexObservation>;
};

async function boundedObservation(read: Readers["ethereum"]): Promise<IndexObservation> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Index health read timed out")), READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return { status: "unavailable", updatedAt: null };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function observe(readers: Readers) {
  const [ethereum, robinhood, base] = await Promise.all([
    boundedObservation(readers.ethereum), boundedObservation(readers.robinhood), boundedObservation(readers.base),
  ]);
  const observations = [ethereum, robinhood, base];
  const status = observations.every(index => index.status === "ready") ? "ready" as const
    : observations.every(index => index.status === "unavailable") ? "unavailable" as const
      : "degraded" as const;
  return {
    schemaVersion: "programmable.operations-health.v2" as const,
    scope: "website-launch-indexes" as const,
    status,
    checkedAt: new Date().toISOString(),
    indexes: [
      { chainId: 1, status: ethereum.status, updatedAt: ethereum.updatedAt,
        catalogUrl: "https://programmable.market/api/explore/ethereum" },
      { chainId: 4663, status: robinhood.status, updatedAt: robinhood.updatedAt,
        catalogUrl: "https://programmable.market/api/explore/robinhood" },
      { chainId: 8453, status: base.status, updatedAt: base.updatedAt,
        catalogUrl: "https://programmable.market/api/explore/base" },
    ],
    // Catalog availability is evidence about a read path, not a provider-wide probe.
    providers: [{ name: "codex" as const,
      roles: ["ethereum-classic-launch-discovery", "ethereum-and-robinhood-market-data"],
      health: "not-checked" as const }],
    customLaunchReadiness: [
      { chainId: 1, readinessUrl: "https://api.programmable.market/readyz",
        capabilitiesUrl: "https://api.programmable.market/v3/capabilities" },
      { chainId: 4663, readinessUrl: "https://api.programmable.market/v4/chains/4663/custom-launch-plans/readiness",
        capabilitiesUrl: "https://api.programmable.market/v4/chains/4663/custom-launch-capabilities" },
      { chainId: 8453, readinessUrl: "https://api.programmable.market/v4/chains/8453/readiness",
        capabilitiesUrl: "https://api.programmable.market/v4/chains/8453/capabilities" },
    ],
  };
}

export function createOperationsHealthReader(readers: Readers = {
  ethereum: readEthereumExploreCatalog, robinhood: readRobinhoodExploreCatalog, base: readBaseExploreCatalog,
}) {
  let cached: { expiresAt: number; value: Awaited<ReturnType<typeof observe>> } | undefined;
  let inFlight: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!inFlight) {
      inFlight = observe(readers).then(value => {
        cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
        return value;
      }).finally(() => { inFlight = undefined; });
    }
    return await inFlight;
  };
}

export const readOperationsHealth = createOperationsHealthReader();
