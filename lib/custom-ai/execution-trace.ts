import type { GeneralCheckPlan } from "./behavior-checks";

export type ObservedValue = { name: string; type: string; value: string; truncated: boolean };
export type ExecutionStep = {
  id: string; contract: string; signature: string; from: "creator" | "trader-a" | "trader-b";
  afterSeconds: number; value: string; read: boolean; status: "success" | "revert";
  outputs: ObservedValue[];
  events: { contract: string; name: string; arguments: ObservedValue[] }[];
  nativeChanges: { account: string; before: string; after: string }[];
  detailsComplete: boolean;
};
export type ExecutionTrace = {
  version: 1; environment: "isolated-declared-fixtures"; networkAccess: false; gasFeesCharged: false;
  plannedSteps: number; executedSteps: number; detailsComplete: boolean; steps: ExecutionStep[];
};

const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit && !value.includes("\0");
const amount = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value);
const keys = (value: unknown, names: string[]): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.keys(value).sort().join() === names.sort().join());
const values = (value: unknown): value is ObservedValue[] => Array.isArray(value) && value.length <= 8 && value.every(item =>
  keys(item, ["name", "type", "value", "truncated"]) && text(item.name, 100) && text(item.type, 200) && text(item.value, 512) && typeof item.truncated === "boolean");

/** Observations are advisory. They never change which independent checks pass. */
export function cachedExecutionTrace(value: unknown, plan?: GeneralCheckPlan): ExecutionTrace | undefined {
  if (!keys(value, ["version", "environment", "networkAccess", "gasFeesCharged", "plannedSteps", "executedSteps", "detailsComplete", "steps"])) return;
  const v = value as ExecutionTrace;
  if (v.version !== 1 || v.environment !== "isolated-declared-fixtures" || v.networkAccess !== false || v.gasFeesCharged !== false
    || !Number.isSafeInteger(v.plannedSteps) || v.plannedSteps < 1 || v.plannedSteps > 256
    || !Number.isSafeInteger(v.executedSteps) || v.executedSteps < 0 || v.executedSteps > v.plannedSteps
    || typeof v.detailsComplete !== "boolean" || !Array.isArray(v.steps) || v.steps.length > 24 || v.steps.length > v.executedSteps
    || new TextEncoder().encode(JSON.stringify(value)).length > 64_000) return;
  const ids = new Set<string>();
  for (let index = 0; index < v.steps.length; index++) {
    const step = v.steps[index];
    if (!keys(step, ["id", "contract", "signature", "from", "afterSeconds", "value", "read", "status", "outputs", "events", "nativeChanges", "detailsComplete"])
      || !identifier(step.id) || ids.has(step.id) || !identifier(step.contract) || !text(step.signature, 800)
      || !["creator", "trader-a", "trader-b"].includes(step.from) || !Number.isSafeInteger(step.afterSeconds) || step.afterSeconds < 0 || step.afterSeconds > 315_360_000
      || !text(step.value, 30) || !/^\d+$/.test(step.value) || typeof step.read !== "boolean" || !["success", "revert"].includes(step.status) || typeof step.detailsComplete !== "boolean"
      || !values(step.outputs) || !Array.isArray(step.events) || step.events.length > 8 || step.events.some(event =>
        !keys(event, ["contract", "name", "arguments"]) || !identifier(event.contract) || !text(event.name, 100) || !values(event.arguments))
      || !Array.isArray(step.nativeChanges) || step.nativeChanges.length > 64 || step.nativeChanges.some(change =>
        !keys(change, ["account", "before", "after"]) || !text(change.account, 80) || !/^(?:(account|contract)\/[a-z][a-z0-9-]{0,63}|recipient\/0x[a-f0-9]{40})$/.test(change.account) || !amount(change.before) || !amount(change.after) || change.before === change.after)
      || new Set(step.nativeChanges.map(change => change.account)).size !== step.nativeChanges.length
      || step.status === "revert" && (step.outputs.length > 0 || step.events.length > 0 || step.nativeChanges.length > 0)
      || step.read && (step.events.length > 0 || step.nativeChanges.length > 0)
      || step.detailsComplete && (step.outputs.some(output => output.truncated) || step.events.some(event => event.arguments.some(arg => arg.truncated)))) return;
    ids.add(step.id);
    if (plan) {
      const declared = plan.steps[index];
      if (!declared || ["id", "contract", "signature", "from", "afterSeconds", "value", "read"].some(key =>
        step[key as keyof ExecutionStep] !== declared[key as keyof typeof declared])) return;
    }
  }
  if (v.detailsComplete !== (v.steps.length === v.executedSteps && v.steps.every(step => step.detailsComplete))
    || plan && v.plannedSteps !== plan.steps.length) return;
  return structuredClone(v);
}

/** Keep conversational context small. Full observations remain in the owned view. */
export function executionContext(trace?: ExecutionTrace) {
  if (!trace) return undefined;
  return { environment: trace.environment, networkAccess: false, gasFeesCharged: false,
    units: "native amounts in wei; other values in raw contract units",
    plannedSteps: trace.plannedSteps, executedSteps: trace.executedSteps, capturedSteps: trace.steps.length, includedSteps: Math.min(8,trace.steps.length),
    observations: trace.steps.slice(0, 8).map(step => ({ id: step.id, contract: step.contract, call: step.signature, status: step.status,
      outputs: step.outputs.slice(0, 3).map(item => ({ name: item.name, value: item.value.slice(0, 160), truncated: item.truncated || item.value.length > 160 })),
      events: step.events.slice(0,2).map(event=>({contract:event.contract,name:event.name,arguments:event.arguments.slice(0,4).map(item=>({name:item.name,value:item.value.slice(0,160),truncated:item.truncated||item.value.length>160}))})),
      nativeChanges: step.nativeChanges.slice(0, 4), detailsComplete: step.detailsComplete && step.outputs.length <= 3 && step.outputs.every(item=>item.value.length<=160)
        && step.nativeChanges.length <= 4 && step.events.length<=2 && step.events.every(event=>event.arguments.length<=4&&event.arguments.every(item=>item.value.length<=160)) })) };
}
