import "server-only";
import { createPublicKey } from "node:crypto";
import { productionAIPool } from "../store.server";
import { configuredAIAllowance } from "../budget.server";
import { CustomAIError } from "../types";
import { productionAccountDependencies } from "./production.server";
import { createRunStore } from "./runs.server";
import { createRunRoutes, createWorkerRoutes } from "./run-http.server";
import { createDispatchService } from "./dispatch.server";
import { verifyWorkerGrant } from "./worker-auth.server";

let store: ReturnType<typeof createRunStore> | undefined;
export function productionRunStore() {
  return store ??= createRunStore(productionAIPool(), { allowance: configuredAIAllowance(), leaseMs: 60_000, capabilities: {
    "model.plan": { units: 1, effect: "read", operations: ["plan", "build", "test", "deploy"] },
    "project.read": { units: 0, effect: "read", operations: ["plan", "build", "test", "deploy"] },
    "project.plan": { units: 1, effect: "write", operations: ["plan", "build"] },
    "project.patch": { units: 1, effect: "write", operations: ["build"] },
    "project.dependencies": { units: 1, effect: "write", operations: ["build"] },
    "project.check": { units: 2, effect: "read", operations: ["build", "test"] },
    "sandbox.command": { units: 1, effect: "read", operations: ["build", "test"] },
    "contract.library": { units: 0, effect: "read", operations: ["plan", "build", "test"] },
    "contract.compile": { units: 2, effect: "read", operations: ["build", "test"] },
    "contract.check": { units: 2, effect: "read", operations: ["build", "test"] },
    "project.publish": { units: 5, effect: "write", operations: ["deploy"] },
    "project.releases": { units: 0, effect: "read", operations: ["plan", "build", "test", "deploy"] },
    "project.promote": { units: 1, effect: "write", operations: ["deploy"] },
    "app.jobs": { units: 0, effect: "read", operations: ["plan", "build", "test", "deploy"] },
    "app.schedule": { units: 1, effect: "write", operations: ["deploy"] },
    "connector.read": { units: 1, effect: "read", operations: ["plan", "build", "test"] },
    "connector.list": { units: 0, effect: "read", operations: ["plan", "build", "test", "deploy"] },
    "connector.write": { units: 2, effect: "write", operations: ["build", "deploy"] },
  } });
}

function workerConfiguration() {
  const key = process.env.PROJECT_RUNTIME_SIGNING_KEY, value = process.env.PROJECT_RUNTIME_WORKER_URL;
  if (!key || !value) throw new CustomAIError("worker-configuration", "Project execution is temporarily unavailable.", 503);
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/v1/work"
    || url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "127.0.0.1")) {
    throw new CustomAIError("worker-configuration", "Project execution is temporarily unavailable.", 503);
  }
  createPublicKey(key);
  return { key, url };
}
export function productionDispatchService() {
  const config = workerConfiguration();
  return createDispatchService(productionAIPool(), productionRunStore(), { signingKey: config.key, sendGrant: async (grant, runId) => {
    const response = await fetch(config.url, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant }) });
    if (![200, 202].includes(response.status)) { await response.body?.cancel(); throw new Error("Worker admission unavailable"); }
    const reader = response.body?.getReader(); if (!reader) throw new Error("Worker response unavailable");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 4096) throw new Error("Invalid worker response"); chunks.push(item.value); }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (result.accepted !== false && !(result.accepted === true && result.runId === runId)) throw new Error("Worker admission mismatch");
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  } });
}
export function productionRunRoutes() {
  return createRunRoutes({ ...productionAccountDependencies(), store: productionRunStore,
    prepare: () => { workerConfiguration(); },
    onQueued: async (scope, runId) => { await productionDispatchService().dispatchOne(scope, runId); } });
}
export function productionWorkerRoutes(advance?: Parameters<typeof createWorkerRoutes>[0]["advance"]) {
  return createWorkerRoutes({ enabled: () => process.env.CUSTOM_AI_PLATFORM_ENABLED === "true", store: productionRunStore, advance,
    authorize: async request => {
      const value = request.headers.get("authorization");
      if (!value?.startsWith("Bearer ")) throw new CustomAIError("worker-grant", "Invalid worker authorization.", 403);
      const key = process.env.PROJECT_RUNTIME_SIGNING_KEY;
      if (!key) throw new CustomAIError("worker-configuration", "Project execution is temporarily unavailable.", 503);
      return verifyWorkerGrant(value.slice(7), createPublicKey(key));
    } });
}
