import "server-only";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import bindings from "./deployments.json";
import bundle from "@/scripts/custom-ai/core-bundle.json";
import { CUSTOM_AI_BUNDLE_HASH } from "./launch-plan";
import { matchesRuntime } from "./runtime";
import type { CustomAIChain } from "./chain.server";

export type CoreDeployment = { chainId: 1 | 4663; bundleHash: string; status: "staged" | "active";
  deploymentBlock?: string;
  factory: { address: Address; runtimeHash: Hex };
  hookDeployer: { address: Address; runtimeHash: Hex };
  liquidityDeployer: { address: Address; runtimeHash: Hex };
  router: { address: Address; runtimeHash: Hex };
  priceSigner: Address; acceptanceEvidenceHash: string | null };

export function currentCustomAIDeployment(chainId: 1 | 4663): CoreDeployment | null {
  return (bindings.networks as Record<string, CoreDeployment | null>)[String(chainId)] ?? null;
}

type PublishedIndexSource = Readonly<{
  chainId: 1 | 4663;
  factory: Address;
  bundleHash: string;
  deploymentBlock: string;
  acceptanceEvidenceHash: string;
}>;

// Read-only history pinned from release 24f70487 and the committed
// docs/operations/custom-ai/funded-acceptance-20261022.json. Retain these entries
// when active bindings change. New historical generations require reviewed pins;
// persisted token records can never add a trusted factory or bundle.
export const CUSTOM_AI_PUBLISHED_INDEX_SOURCES: readonly PublishedIndexSource[] = Object.freeze([
  Object.freeze({ chainId: 1 as const, factory: "0x8E40C2917Bf43f6d93710f8Dcc7A449BD76525aD" as Address,
    bundleHash: "50f90512fc91a45f6bf2aa204db0a04628540fb21a000309f6288fb46495d249", deploymentBlock: "26245676",
    acceptanceEvidenceHash: "0bbcf81f4f141b29f900e9a8e4c2e6e873a51533a622c99e2c0019143ba62fe5" }),
  Object.freeze({ chainId: 4663 as const, factory: "0xEE92C51F4d99b269e50Bb567d2Adf04141A603b4" as Address,
    bundleHash: "50f90512fc91a45f6bf2aa204db0a04628540fb21a000309f6288fb46495d249", deploymentBlock: "94826255",
    acceptanceEvidenceHash: "0bbcf81f4f141b29f900e9a8e4c2e6e873a51533a622c99e2c0019143ba62fe5" }),
]);

export function publishedCustomAIIndexSources(chainId: 1 | 4663): readonly PublishedIndexSource[] {
  const history = CUSTOM_AI_PUBLISHED_INDEX_SOURCES.filter(source => source.chainId === chainId);
  const current = currentCustomAIDeployment(chainId);
  if (current?.status !== "active" || !current.deploymentBlock || !current.acceptanceEvidenceHash
    || history.some(source => source.factory.toLowerCase() === current.factory.address.toLowerCase() && source.bundleHash === current.bundleHash)) return history;
  // Only the committed active release binding can supplement the pinned history.
  return [...history, { chainId, factory: current.factory.address, bundleHash: current.bundleHash,
    deploymentBlock: current.deploymentBlock, acceptanceEvidenceHash: current.acceptanceEvidenceHash }];
}

export async function verifyCustomAIDeployment(chain: CustomAIChain, deployment: CoreDeployment) {
  if (deployment.chainId !== chain.chainId || deployment.bundleHash !== CUSTOM_AI_BUNDLE_HASH
    || bundle.bundleHash !== CUSTOM_AI_BUNDLE_HASH) throw Error("The core deployment does not match this build.");
  const roles = { factory: "CustomAIFactoryV1", hookDeployer: "CustomAIHookDeployerV1",
    liquidityDeployer: "CustomAILiquidityDeployerV1", router: "CustomAISwapRouterV1" } as const;
  for (const [role, contract] of Object.entries(roles)) {
    const pin = deployment[role as keyof typeof roles];
    const code = await chain.code(pin.address);
    const artifact = bundle.contracts[contract];
    if (keccak256(code) !== pin.runtimeHash || !matchesRuntime(code, { ...artifact, runtimeTemplate: artifact.runtimeTemplate as Hex })) {
      throw Error("The deployed core bytecode changed.");
    }
  }
  const manager = chain.profile.infrastructure.poolManager;
  if (keccak256(await chain.code(manager.address)) !== manager.runtimeCodeHash) throw Error("The PoolManager changed.");
  const expected = { poolManager: manager.address, hookDeployer: deployment.hookDeployer.address,
    liquidityDeployer: deployment.liquidityDeployer.address, router: deployment.router.address,
    priceSigner: deployment.priceSigner, managerCodeHash: manager.runtimeCodeHash,
    deployerCodeHash: deployment.hookDeployer.runtimeHash, liquidityDeployerCodeHash: deployment.liquidityDeployer.runtimeHash,
    routerCodeHash: deployment.router.runtimeHash, CORE_VERSION: keccak256(stringToHex("programmable.custom-ai.core.v1")) };
  await Promise.all(Object.entries(expected).map(async ([name, value]) => {
    const type = value.length === 42 ? "address" : "bytes32";
    const result = await chain.call(deployment.factory.address, `function ${name}() view returns (${type})`);
    if (typeof result !== "string" || result.toLowerCase() !== value.toLowerCase()) throw Error("The core configuration changed.");
  }));
  const routerManager = await chain.call(deployment.router.address, "function poolManager() view returns (address)");
  if (typeof routerManager !== "string" || routerManager.toLowerCase() !== manager.address.toLowerCase()) throw Error("The router uses another PoolManager.");
  await chain.finish();
}

export function customAICanaryAccount(account?: string) {
  return !!account && (process.env.CUSTOM_AI_CANARY_WALLETS?.split(",").map(value => value.trim().toLowerCase()).includes(account.toLowerCase()) ?? false);
}
