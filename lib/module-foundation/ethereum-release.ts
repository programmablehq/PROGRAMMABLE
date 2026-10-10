import { getAddress, type Hex } from "viem";
import previousRelease from "@/contracts/deployments/ethereum-module-release-v1.json";
import release from "@/contracts/deployments/ethereum-module-release-v2.json";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import type { FoundationEthereumGraphSource } from "./ethereum-graph";
import type { FoundationDeploymentBinding } from "./protocol";
import { FOUNDATION_LP_CUSTODY_DEAD_ID } from "./constants";

/** Installed source identity. Activation and current chain evidence are supplied separately. */
function sourceOf(entry: typeof previousRelease): FoundationEthereumGraphSource {
  return Object.freeze({
    chainId: 1, releaseDigest: entry.releaseDigest as Hex,
    sourceCommit: entry.payload.sourceCommit, startBlock: BigInt(entry.payload.startBlock),
    implementation: { address: getAddress(entry.payload.implementation.address),
      runtimeCodeHash: entry.payload.implementation.runtimeCodeHash as Hex },
    proxyRuntimeCodeHash: entry.payload.proxyRuntimeCodeHash as Hex,
  });
}
export const ETHEREUM_MODULE_SOURCE = sourceOf(release);
export const ETHEREUM_MODULE_SOURCES = Object.freeze([ETHEREUM_MODULE_SOURCE, sourceOf(previousRelease)]);

export function ethereumModuleSourceByRelease(digest: unknown) {
  return typeof digest === "string"
    ? ETHEREUM_MODULE_SOURCES.find(source => source.releaseDigest.toLowerCase() === digest.toLowerCase()) : undefined;
}

export function ethereumModuleBinding(source: FoundationEthereumGraphSource): FoundationDeploymentBinding {
  return Object.freeze({
  chainId: 1, factoryVersion: "v3", lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID,
  releaseDigest: source.releaseDigest, sourceCommit: source.sourceCommit,
  startBlock: source.startBlock, factory: source.implementation,
  hookDeployer: { address: getAddress(ethereum.canonicalStamp.graphFactory.address),
    runtimeCodeHash: ethereum.canonicalStamp.graphFactory.runtimeCodeHash as Hex },
  ethereumGraph: source,
  });
}
export const ETHEREUM_MODULE_BINDING = ethereumModuleBinding(ETHEREUM_MODULE_SOURCE);

/** Routing hint from a canonical stamp. Market reads still verify the proxy's
 * implementation, initializer, runtime and pool before enabling any action. */
export function ethereumModuleSourceForStamp(entry: { launchStampProvenance?: import("@/lib/tokens").LaunchStampProvenanceV1 | null } | null | undefined) {
  const stamp = entry?.launchStampProvenance;
  return !!stamp && stamp.chainId === 1 && stamp.kind === "custom-graph"
    && stamp.routerAddress.toLowerCase() === ethereum.canonicalStamp.router.address.toLowerCase()
    && stamp.routeLauncherAddress.toLowerCase() === ethereum.canonicalStamp.graphFactory.address.toLowerCase()
    && stamp.components.length === 3
    ? ETHEREUM_MODULE_SOURCES.find(source => BigInt(stamp.blockNumber) >= source.startBlock
      && stamp.components.filter(component => component.kind === "other" && component.scope === "exclusive"
        && component.runtimeCodeHash.toLowerCase() === source.proxyRuntimeCodeHash.toLowerCase()).length === 1)
    : undefined;
}

export function isEthereumModuleLaunchCandidate(entry: Parameters<typeof ethereumModuleSourceForStamp>[0]): boolean {
  return !!ethereumModuleSourceForStamp(entry);
}
