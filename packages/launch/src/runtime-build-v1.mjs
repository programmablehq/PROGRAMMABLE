import { buildGraphBundle } from "./graph.mjs";
import { canonicalizeJson } from "./canonical-json.mjs";
import { assertExactKeys } from "./io.mjs";
import { normalizeRuntimeMaterialization } from "./runtime-immutables.mjs";

/** Trusted local integration only. The internal prediction is never a request,
 * admission or permit. All final graph/profile/source validators still follow. */
export async function completeGraphRuntimeV1({ targets, graph, graphOptions, chainId, launchWallet, materialize }) {
  if (typeof materialize !== "function") throw new TypeError("runtime materializer must be a trusted local function");
  const originalPredictions = structuredClone(graph.predictions);
  const observed = await materialize(structuredClone({ chainId, launchWallet, predictions: originalPredictions }));
  assertExactKeys(observed, ["targets"], "runtime materialization");
  if (!Array.isArray(observed.targets) || observed.targets.length !== targets.length
    || new Set(observed.targets.map(target => target.targetId)).size !== targets.length
    || Buffer.byteLength(JSON.stringify(observed)) > 4_000_000) throw new TypeError("runtime materialization must cover every exact graph target");
  const inventory = new Map(observed.targets.map(target => {
    assertExactKeys(target, ["targetId", "runtimeImmutables", "runtimeCodeHash"], "runtime materialization target");
    if (!/^0x(?!0{64}$)[a-f0-9]{64}$/.test(target.runtimeCodeHash)) throw new TypeError("runtime materialization requires an exact code hash");
    return [target.targetId, target];
  }));
  const completedTargets = targets.map(target => {
    const words = inventory.get(target.targetId), prediction = originalPredictions.find(value => value.targetId === target.targetId);
    if (!words || !prediction || !target.runtimeMaterialization) throw new TypeError("runtime materialization differs from the exact compiler graph");
    return { ...target,
      // Keep the already mined salt. Runtime words do not change creation bytes
      // and must never trigger a second permission grind or a fresh address.
      applicantSalt: prediction.applicantSalt,
      runtimeMaterialization: normalizeRuntimeMaterialization({ runtimeCode: target.runtimeCode,
        immutableReferences: Object.fromEntries(target.runtimeMaterialization.immutableReferences.map(value => [value.immutableId, value.ranges])),
        runtimeImmutables: words.runtimeImmutables, label: `materialized target ${target.targetId}` }) };
  });
  const completedGraph = buildGraphBundle({ ...graphOptions, targets: completedTargets });
  if (canonicalizeJson(completedGraph.predictions) !== canonicalizeJson(originalPredictions)) throw new TypeError("runtime materialization changed exact constructor predictions");
  for (const target of completedGraph.graphBundle.targets) {
    if (target.expectedRuntimeCodeHash !== inventory.get(target.targetId).runtimeCodeHash) throw new TypeError("runtime words do not reproduce the observed constructor code");
  }
  return { targets: completedTargets, graph: completedGraph, receipt: { version: 1,
    targets: completedTargets.map(target => ({ targetId: target.targetId, applicantSalt: target.applicantSalt,
      runtimeImmutables: target.runtimeMaterialization.runtimeImmutables, runtimeCodeHash: inventory.get(target.targetId).runtimeCodeHash })) } };
}
