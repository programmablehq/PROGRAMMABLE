import "server-only";
import { getAddress, type Hex } from "viem";
import { CustomAIError } from "./types";
import type { BoundRuleSpec } from "./rule-compiler.server";
import { productionAIStore } from "./store.server";
import { customAIChain } from "./chain.server";
import { currentCustomAIDeployment } from "./deployment.server";
import { matchesRuntime } from "./runtime";
import code from "./composable-code.json";
import { readOperationalSnapshot } from "./operation-health.server";
export type ComposableRelease = { chainId: 1 | 4663; status: "active"; acceptanceHash: string; bundleHash: string;
  programFactory: string; feedIds: string[]; actions: string[] };
export async function assertComposableAvailable(binding: BoundRuleSpec) {
  const raw = process.env.CUSTOM_AI_COMPOSABLE_RELEASES ?? "[]";
  if (raw.length > 32000) throw new CustomAIError("release", "This launch capability is unavailable.", 503);
  const releases = JSON.parse(raw) as ComposableRelease[];
  const release = Array.isArray(releases) ? releases.find(r => r.chainId === binding.chainId && r.status === "active") : undefined;
  if (!release || !/^[0-9a-f]{64}$/.test(release.acceptanceHash) || release.bundleHash !== code.bundleHash
    || !Array.isArray(release.feedIds) || !Array.isArray(release.actions)
    || binding.feeds.some(f => !release.feedIds.includes(f.id)) || binding.spec.actions.some(a => !release.actions.includes(a.kind))) {
    throw new CustomAIError("release", "Your combined design is saved. This network is not yet enabled for these rules.", 503);
  }
  const dependencies = [...(binding.feeds.length ? ["feeds"] : []), ...(binding.spec.actions.length ? ["programs", "prices"] : [])];
  if (dependencies.length && (await readOperationalSnapshot(productionAIStore(), binding.chainId, dependencies)).status !== "ready") {
    throw new CustomAIError("worker", "The required data or execution service is reconnecting. Your design is saved.", 503);
  }
  if (binding.spec.actions.length) {
    const chain = await customAIChain(binding.chainId);
    const address = getAddress(release.programFactory);
    const artifacts = code.contracts as Record<string, { runtimeTemplate: Hex; immutableReferences: Record<string, {start:number; length:number}[]> }>;
    if (!artifacts.CustomAIProgramFactoryV1 || !matchesRuntime(await chain.code(address), artifacts.CustomAIProgramFactoryV1)) throw new CustomAIError("release", "The program deployment does not match this release.", 503);
    const core = await chain.call(address, "function core() view returns(address)");
    if (String(core).toLowerCase() !== currentCustomAIDeployment(binding.chainId)?.factory.address.toLowerCase()) throw new CustomAIError("release", "The programs belong to a different launch version.", 503);
    for (const [getter, contract] of [["routers", "CustomAIProgramRouterDeployerV1"], ["liquidityPrograms", "CustomAILiquidityProgramDeployerV1"], ["fundedPrograms", "CustomAIFundedProgramDeployerV1"], ["prices", "CustomAIExecutionPriceFeedV1"]]) {
      const target = getAddress(String(await chain.call(address, `function ${getter}() view returns(address)`)));
      if (!matchesRuntime(await chain.code(target), artifacts[contract])) throw new CustomAIError("release", "A program dependency does not match this release.", 503);
    }
    await chain.finish();
  }
  return release;
}
