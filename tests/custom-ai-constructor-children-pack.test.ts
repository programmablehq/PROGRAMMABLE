import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getContractAddress, keccak256 } from "viem";
import { generalPackFixture } from "./fixtures/custom-ai-general-pack";
import { packGeneralGraph } from "../lib/custom-ai/general-pack.server";
import { packGeneralRobinhoodPlan } from "../lib/custom-ai/general-plan-pack.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("source-bound constructor child launch packs", { timeout: 120_000 }, () => {
  it.each([1, 4663, 8453, 999] as const)("keeps all six actual instances on chain %s with only three direct deployment actions", async chain => {
    const input = await generalPackFixture(chain, false, 0, true);
    expect(input.source.project.entrypoints).toHaveLength(5);
    expect(input.source.scenarios).toMatchObject({ version: 2, scope: "isolated-declared-scenarios-v2", passed: true, cases: 21, launchReady: false });
    const packed = chain === 4663 ? await packGeneralRobinhoodPlan(input, { address: input.controller, kind: "eoa" }) : await packGeneralGraph(input);
    const runtime = packed.route === "plan-v1" ? packed.runtimeMaterialization : packed.constructorMaterialization!;
    expect(packed.version).toBe(2); expect(runtime.contracts).toHaveLength(3); expect(runtime.children).toHaveLength(3);
    const parent = runtime.targets.find(target => target.id === "hook")!.address;
    for (const [index, child] of runtime.children!.entries()) {
      expect(child.address).toBe(getContractAddress({ from: parent, nonce: BigInt(index + 1) }));
      expect(keccak256(child.runtimeCode)).toBe(child.runtimeCodeHash);
      expect(runtime.constructorChildren!.find(instance => instance.id === child.id)!.address).toBe(child.address);
    }
    const request = JSON.parse(packed.requestBody);
    if (packed.route === "plan-v1") {
      expect(request.components).toHaveLength(6); expect(request.verificationBundle.components).toHaveLength(6);
      expect(request.actions.filter((action: { kind: string }) => action.kind === "deployCreate2")).toHaveLength(3);
      expect(request.expectedEffects.filter((effect: { kind: string }) => effect.kind === "child")).toHaveLength(3);
      const parentAction = request.actions.find((action: { actionId: string }) => action.actionId === "deploy-hook");
      for (const child of runtime.children!) {
        expect(parentAction.postconditions).toContain(`${child.id}-created`);
        expect(request.components.find((component: { componentId: string }) => component.componentId === child.id)).toMatchObject({ expectedAddress: child.address, runtimeCodeHash: child.runtimeCodeHash });
        const verification = request.verificationBundle.components.find((component: { targetId: string }) => component.targetId === child.id);
        expect(verification.runtimeMaterialization.deployedRuntimeCodeHash).toBe(child.runtimeCodeHash);
        expect(verification.constructorArguments).toBe(runtime.constructorChildren!.find(instance => instance.id === child.id)!.constructorArguments);
      }
    } else {
      // Canonical graph V3's direct-target wire stays unchanged. Child source
      // is in the original Standard JSON; the complete observations stay in
      // the owned private pack rather than inventing fields in the SDK API.
      expect(request.schemaVersion).toBe("programmable.custom-launch-create-request.v3");
      expect(packed.runtimeMaterialization.targets).toHaveLength(3);
      expect(request).not.toHaveProperty("constructorMaterialization");
    }
    const { hash, ...body } = packed;
    expect(hash).toBe(canonicalBrowserSha256V2(`programmable.custom-ai-general-${packed.route === "plan-v1" ? "plan" : "graph"}-pack.v2`, body));
    expect(packed.launchReady).toBe(false);
    for (const privateText of ["Private packing fixture request must not be public", "pack-fixture-owner"])
      expect(packed.requestBody).not.toContain(privateText);
  });
});
