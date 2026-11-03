import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { recoverCompletedInterface, recoverCorrectedDeployment } from "../lib/custom-ai/interface-recovery";
import { declareGeneralChecks } from "../lib/custom-ai/check-declaration.server";
import { checkContextHash } from "../lib/custom-ai/check-diagnostic";
import { ModelResponseError } from "../lib/custom-ai/model-response";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";

const intent: LaunchIntent = { version: 1, id: "interface-recovery", revision: "a".repeat(64), unresolved: [], changes: [],
  requirements: [{ id: "count", kind: "behavior", text: "Read a counter", open: null, origin: { kind: "legacy" } }] };
const graph = { contracts: [{ id: "main", source: "Counter.sol", contract: "Counter", role: "auxiliary", arguments: [],
  functions: [], allowReceive: false, allowFallback: false, surfaceRequirements: [] }], allowedCalls: [] };
const interfaces = [{ id: "main", canonical: null, functions: ["function count() view returns(uint256)"] }];
const partial = `\`\`\`json\n{"interfaces":${JSON.stringify(interfaces)},"deployment":{"targets":[`;
const input = { intent, chainId: 1 as const, evmVersion: "paris" as const, model: "test-model" };
const response = (body: unknown) => ({ text: JSON.stringify(body), inputTokens: 1, outputTokens: 1 });
const deployment = { format: "fixture-refs-v2", targets: [{ id: "main", argumentsJson: "[]", initializerFunction: null,
  initializerArgumentsJson: "[]", deploymentValue: "0", initializerValue: "0", hookPermissions: null }], constructorChildren: [],
  pool: { token: "main", hook: "main", initializer: "main", platformFeeBinding: "main", fee: 0, tickSpacing: 60 },
  fees: null, liquidityModel: null, openingPrice: null };
const correction = (next: unknown = deployment) => `${JSON.stringify({ deployment })}\nThe corrected object follows.\n${JSON.stringify({ deployment: next })}`;

describe("completed public-interface recovery", () => {
  it("recovers a complete ABI before an interrupted deployment without accepting deployment bytes", () => {
    expect(JSON.parse(recoverCompletedInterface(partial, graph)!)).toEqual({ interfaces, deployment: null });
  });
  it("does not recover a truncated array, unknown identity, duplicate identity or an unrelated root field", () => {
    const invalid = [partial.slice(0, partial.indexOf('returns')), partial.replace('"main"', '"other"'),
      `{"interfaces":${JSON.stringify([...interfaces, ...interfaces])},"deployment":{`,
      `{"command":"run","interfaces":${JSON.stringify(interfaces)},"deployment":{`];
    for (const value of invalid) expect(recoverCompletedInterface(value, graph)).toBeUndefined();
  });
  it("handles brackets and escaped quotes inside a completed signature as data", () => {
    const values = [{ ...interfaces[0], functions: ['function list(uint256[]) view returns(uint256[])'] }];
    expect(JSON.parse(recoverCompletedInterface(`{"interfaces":${JSON.stringify(values)},"deployment":{`, graph)!).interfaces).toEqual(values);
  });
  it("reuses a private completed ABI without a second graph or ABI request", async () => {
    const rejected = { version: 1 as const, contextHash: checkContextHash(input), progress: { interface: JSON.stringify(graph), steps: [], interfacesPending: true as const },
      failures: [{ stage: "interface" as const, message: "Output stopped inside deployment", declaration: null, response: partial }] };
    const call = vi.fn().mockResolvedValue(response({ steps: [{ id: "read", call: "main:count()", argumentsJson: "[]", from: "trader-a", afterSeconds: 0,
      value: "0", read: true, requirementIds: ["count"], expect: { status: "success", returnsJson: '["0"]', swapFeePpm: null, events: [] } }], complete: true }));
    const result = await declareGeneralChecks({ ...input, rejected }, call);
    expect(result.scenarios.steps).toHaveLength(1);
    expect(call.mock.calls.map(([request]) => request.task)).toEqual(["scenarios"]);
  });
  it("preserves the finished ABI when the separate production step is interrupted", async () => {
    const production = projectLaunchProductionContext(captured.chains["1"], 1);
    const current = { ...input, production };
    const rejected = { version: 1 as const, contextHash: checkContextHash(current), progress: { interface: JSON.stringify(graph), steps: [], interfacesPending: true as const },
      failures: [{ stage: "interface" as const, message: "Output stopped inside deployment", declaration: null, response: partial }] };
    const call = vi.fn().mockRejectedValue(new ModelResponseError("timeout", { inputTokens: 0, outputTokens: 0 }));
    const error = await declareGeneralChecks({ ...current, rejected }, call).catch(value => value);
    expect(call.mock.calls.map(([request]) => request.task)).toEqual(["interface-deployment"]);
    expect(error.diagnostic.progress.interfacesPending).toBeUndefined();
    expect(JSON.parse(error.diagnostic.progress.interface).contracts[0].functions).toEqual(interfaces[0].functions);
    const resume = vi.fn().mockRejectedValue(new ModelResponseError("timeout", { inputTokens: 0, outputTokens: 0 }));
    await declareGeneralChecks({ ...current, rejected: error.diagnostic }, resume).catch(() => undefined);
    expect(resume.mock.calls.map(([request]) => request.task)).toEqual(["interface-deployment"]);
  });
});

describe("explicitly corrected deployment data", () => {
  it("uses the complete replacement and preserves JSON strings containing braces", () => {
    const next = { ...deployment, targets: [{ ...deployment.targets[0], argumentsJson: '[{"input":"name"}]' }] };
    expect(JSON.parse(recoverCorrectedDeployment(correction(next), graph)!)).toEqual({ deployment: next });
  });
  it("rejects ambiguous, incomplete, oversized and foreign graph data", () => {
    const invalid = [correction().replace("The corrected object follows.", "Another object."),
      correction().slice(0, -1), correction() + JSON.stringify({ deployment }),
      correction() + " trailing text", correction().replace('"deployment":', '"command":'),
      correction({ ...deployment, targets: [{ ...deployment.targets[0], id: "foreign" }] }),
      correction({ ...deployment, unexpected: true }), correction() + " ".repeat(96_001)];
    for (const value of invalid) expect(recoverCorrectedDeployment(value, graph)).toBeUndefined();
  });
  it.each([false, true])("retains completed interfaces and resumes scenarios without a second deployment call (saved=%s)", async saved => {
    const production = projectLaunchProductionContext(captured.chains["1"], 1);
    const current = { ...input, production };
    const ready = { ...graph, contracts: [{ ...graph.contracts[0], functions: interfaces[0].functions }] };
    const failure = { stage: "interface" as const, message: "Invalid JSON", declaration: null, response: correction() };
    const rejected = { version: 1 as const, contextHash: checkContextHash(current),
      progress: { interface: JSON.stringify(ready), steps: [] }, failures: saved ? [failure] : [{ ...failure, response: undefined }] };
    const call = vi.fn(async request => {
      if (request.task === "interface-deployment") throw new ModelResponseError("invalid-schema", { inputTokens: 1, outputTokens: 1 }, correction());
      throw new ModelResponseError("timeout", { inputTokens: 0, outputTokens: 0 });
    });
    const error = await declareGeneralChecks({ ...current, rejected }, call).catch(value => value);
    expect(call.mock.calls.map(([request]) => request.task)).toEqual(saved ? ["scenarios"] : ["interface-deployment", "scenarios"]);
    expect(error.diagnostic.progress.interfacesPending).toBeUndefined();
    expect(JSON.parse(error.diagnostic.progress.interface).deployment).toBeDefined();
  });
});
