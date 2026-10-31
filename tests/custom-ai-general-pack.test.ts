import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generalPackFixture } from "./fixtures/custom-ai-general-pack";
import { generalGraphPackConfig, type GeneralPackInput } from "../lib/custom-ai/general-pack-config.server";
import { packGeneralGraph } from "../lib/custom-ai/general-pack.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
// @ts-expect-error The canonical SDK is an untyped native ESM integration.
import { buildLaunch } from "../packages/launch/src/pack.mjs";

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("owned general graph source packing", { timeout: 120_000 }, () => {
  const fixtures = new Map<number, GeneralPackInput>();
  beforeAll(async () => { for (const chain of [1, 8453, 999] as const) fixtures.set(chain, await generalPackFixture(chain)); }, 120_000);
  it("uses the canonical three graph profiles and only public source files, without borrowing Robinhood's route", () => {
    for (const chain of [1,8453,999]) {
      const input = fixtures.get(chain)!, plan = generalGraphPackConfig(input);
      expect(plan.config.chainId).toBe(String(chain)); expect(plan.config.source.publicOrigin.url).toBe(input.url);
      expect(plan.config.launchProfile.liquidityModel).toMatchObject({ model: "external-concentrated-liquidity", declaredLaunchState: "liquidity_required" });
      expect(plan.config.launchProfile.applicantSelectedBuyHundredthsOfBip).toBe("30000");
      expect(plan.config.targets[1].declaredHookPermissions).toEqual(["beforeInitialize"]);
      const bytes = plan.files.map(file => Buffer.from(file.bytes).toString()).join();
      expect(bytes).not.toContain("Private packing fixture request must not be public"); expect(bytes).not.toContain("pack-fixture-owner");
      expect(plan.launchReady).toBe(false); expect(plan.source.project.production?.protectionPolicy?.required).toBe(true);
    }
    const changed = structuredClone(fixtures.get(1)!); changed.source.project.chainId = 4663;
    expect(() => generalGraphPackConfig(changed)).toThrow();
  });
  it.each([1,8453,999])("packs actual compiler/runtime words on chain %i without submitting or claiming review", async chain => {
    const input = structuredClone(fixtures.get(chain)!), originalName = input.source.binding.settings.name;
    const running = packGeneralGraph(input);
    input.source.binding.settings.name = "changed after dispatch"; input.identity.nonce = `0x${"33".repeat(32)}`;
    const packed = await running, request = JSON.parse(packed.requestBody);
    expect(packed).toMatchObject({ route: "graph-v3", chainId: chain, bindingHash: fixtures.get(chain)!.source.bindingHash, launchReady: false });
    expect(request.projectMetadata.token.name).toBe(originalName); expect(request.nonce).toBe(fixtures.get(chain)!.identity.nonce);
    expect(request.launchProfile).toEqual(fixtures.get(chain)!.source.project.production!.graphProfile);
    expect(packed.requestSha256).toBe(`sha256:${createHash("sha256").update(packed.requestBody).digest("hex")}`);
    expect(packed.runtimeMaterialization.targets).toHaveLength(3);
    const token = packed.runtimeMaterialization.targets.find(target => target.targetId === "token")!;
    expect(token.runtimeImmutables.map(word => word.literal.toLowerCase())).toContain(`0x${input.controller.slice(2).toLowerCase().padStart(64,"0")}`);
    for (const key of ["permit", "approval", "broadcast", "launchReady"]) expect(request).not.toHaveProperty(key);
    if (chain === 1) {
      const root = await mkdtemp(join(tmpdir(), "custom-ai-pack-replay-"));
      try {
        const plan = generalGraphPackConfig(fixtures.get(chain)!);
        for (const file of plan.files) { const target = join(root, file.path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, file.bytes); }
        const configPath = join(root,"config.json"); await writeFile(configPath,JSON.stringify(packed.reproducibleConfig));
        const reproduced = await buildLaunch({ configPath, directNativeProfileVersion: "3.6.0", directNativeRouter: plan.source.project.production!.executor.address,
          directNativeTradeFeePolicy: plan.source.project.production!.graphProfile!.programmableTradeFeePolicy });
        expect(reproduced.requestSha256).toBe(packed.requestSha256); expect(reproduced.requestBytes.toString()).toBe(packed.requestBody);
      } finally { await rm(root, { recursive: true, force: true }); }
    }
  });
  it("rejects stale source bindings, an unowned image, another controller and missing applicant declarations before a worker", async () => {
    for (const change of [
      (input: GeneralPackInput) => { input.source.binding.settings.name = "changed"; },
      (input: GeneralPackInput) => { input.imageBytes = new Uint8Array([1,2,3]); },
      (input: GeneralPackInput) => { input.controller = `0x${"44".repeat(20)}`; },
      (input: GeneralPackInput) => { input.url = "https://example.com/invented-source"; },
    ]) {
      const input = structuredClone(fixtures.get(1)!); change(input);
      await expect(packGeneralGraph(input)).rejects.toMatchObject({ code: "launch-pack" });
    }
    const input = structuredClone(fixtures.get(1)!); input.source.binding.settings.website = "";
    input.source.bindingHash = canonicalBrowserSha256V2("programmable.custom-ai-launch-source.v1",input.source.binding);
    await expect(packGeneralGraph(input)).rejects.toThrow("HTTPS website");
    const stop = new AbortController(); stop.abort(Error("stopped"));
    await expect(packGeneralGraph(fixtures.get(1)!,stop.signal)).rejects.toThrow("stopped");
  });
  it("keeps unknown constructor environment unresolved rather than submitting zero runtime words", async () => {
    const input = await generalPackFixture(1,true);
    await expect(packGeneralGraph(input)).rejects.toMatchObject({ code: "runtime-dependency", status: 422 });
  });
});
