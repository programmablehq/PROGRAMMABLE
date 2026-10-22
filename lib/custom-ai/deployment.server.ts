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
