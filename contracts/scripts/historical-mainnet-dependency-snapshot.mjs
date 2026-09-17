import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Exact bytes of the reviewed Mainnet snapshot retained by the historical
// release. Current registry/fork checks continue to use ethereum-mainnet.json.
export const HISTORICAL_MAINNET_DEPENDENCY_SNAPSHOT = Object.freeze({
  file: "dependencies/historical/ethereum-mainnet-25612664.json",
  sha256: "fbeee8e6323c28d4fed7f755d3c8f27979e67f42139d8883a20c1c4867d03da2",
});

export function readHistoricalMainnetDependencySnapshot() {
  const bytes = readFileSync(
    new URL(`../${HISTORICAL_MAINNET_DEPENDENCY_SNAPSHOT.file}`, import.meta.url),
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== HISTORICAL_MAINNET_DEPENDENCY_SNAPSHOT.sha256) {
    throw new Error("Historical Mainnet dependency snapshot SHA-256 mismatch");
  }
  return JSON.parse(bytes.toString("utf8"));
}
