import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

// Public, read-only samples. Never call a cron, full scan, wallet or write API.
export const TARGETS = Object.freeze([
  { id: "indexes", url: "https://programmable.market/api/ops/health" },
  { id: "ethereum", chainId: 1, tokenAddress: "0x1b54e762aa34cf6e28e9c082f2848e28e45da6b8", url: "https://programmable.market/api/explore/ethereum/presentation?token=0x1b54e762aa34cf6e28e9c082f2848e28e45da6b8" },
  { id: "robinhood", chainId: 4663, tokenAddress: "0xc60ba256b44334a0cd2c7242e98b88f031abb006", url: "https://programmable.market/api/explore/robinhood/presentation?token=0xc60ba256b44334a0cd2c7242e98b88f031abb006" },
  { id: "api", url: "https://api.programmable.market/readyz" },
  { id: "robinhood-api", url: "https://api.programmable.market/v4/chains/4663/custom-launch-plans/readiness" },
  { id: "base-api", url: "https://api.programmable.market/v4/chains/8453/readiness" },
]);

const MAX_BYTES = 512_000;
const INDEX_MAX_AGE_MS = 20 * 60_000;
const MARKET_MAX_AGE_MS = 35 * 60_000;
const INDEX_CHAIN_IDS = [1, 4663, 8453, 999];
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const address = /^0x[0-9a-f]{40}$/i;
const commit = /^[0-9a-f]{40}$/;
const age = (value, now) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? now - Date.parse(value) : Infinity;
const identity = value => `${value.chainId}:${typeof value.tokenAddress === "string" ? value.tokenAddress.toLowerCase() : ""}`;

async function boundedJson(response) {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw Error("non_json");
  if (!response.body) throw Error("empty_body");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw Error("body_too_large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}

export async function collectObservations(request = fetch, now = Date.now) {
  const observations = [];
  const deadline = AbortSignal.timeout(35_000);
  for (let offset = 0; offset < TARGETS.length; offset += 2) {
    observations.push(...await Promise.all(TARGETS.slice(offset, offset + 2).map(async target => {
      const started = now();
      try {
        const response = await request(target.url, {
          method: "GET", redirect: "error",
          signal: AbortSignal.any([deadline, AbortSignal.timeout(8_000)]),
        });
        if (!response.ok) { await response.body?.cancel(); return { id: target.id, http: response.status, elapsedMs: now() - started, error: "http_error" }; }
        return { id: target.id, http: response.status, elapsedMs: now() - started, body: await boundedJson(response) };
      } catch (error) {
        // Do not retain provider bodies, request URLs, exception text or credentials.
        return { id: target.id, elapsedMs: now() - started,
          error: error instanceof Error && ["non_json", "empty_body", "body_too_large"].includes(error.message) ? error.message : "request_failed" };
      }
    })));
  }
  return observations;
}

export function assessHealth(observations, now = Date.now()) {
  const issues = [];
  const summary = {};
  const add = (code, severity = "error") => issues.push({ code, severity });
  for (const target of TARGETS) {
    const observation = observations.find(value => value.id === target.id);
    if (!observation || observation.error || observation.http !== 200 || !object(observation.body)) {
      add(`${target.id}:unavailable`); continue;
    }
    const body = observation.body;
    summary[target.id] = { status: body.status ?? body.mode, elapsedMs: observation.elapsedMs };
    if (observation.elapsedMs > 6_000) add(`${target.id}:slow`, "warning");
    if (target.id === "indexes") {
      if (body.schemaVersion !== "programmable.operations-health.v2" || !Array.isArray(body.indexes)
        || body.indexes.some(value => !object(value) || !Number.isSafeInteger(value.chainId) || value.chainId <= 0)
        || new Set(body.indexes.map(value => value.chainId)).size !== body.indexes.length) {
        add("indexes:invalid_response"); continue;
      }
      if (age(body.checkedAt, now) > 3 * 60_000 || age(body.checkedAt, now) < -2 * 60_000) add("indexes:stale_health");
      for (const chainId of INDEX_CHAIN_IDS) {
        const index = body.indexes.find(value => value.chainId === chainId);
        if (!index || !["ready", "partial", "syncing", "stale", "unavailable"].includes(index.status)) add(`index-${chainId}:invalid_response`);
        else if (index.status === "unavailable") add(`index-${chainId}:unavailable`);
        else if (age(index.updatedAt, now) > INDEX_MAX_AGE_MS || age(index.updatedAt, now) < -2 * 60_000) add(`index-${chainId}:stale`, "warning");
        else if (index.status === "partial") add(`index-${chainId}:incomplete`, "warning");
      }
    } else if (target.chainId) {
      if (!Array.isArray(body.items) || body.items.length !== 1 || body.items.some(value => !object(value))) {
        add(`${target.id}:market_data_missing`); continue;
      }
      const identities = body.items.map(identity);
      if (new Set(identities).size !== identities.length || body.items.some(item => item.chainId !== undefined && item.chainId !== target.chainId
        || !address.test(item.tokenAddress ?? "") || item.tokenAddress.toLowerCase() !== target.tokenAddress)) add(`${target.id}:wrong_identity`);
      const markets = body.items.filter(value =>
        object(value.market) && Number.isFinite(value.market.priceUsd) && value.market.priceUsd > 0
        && [value.market.marketCapUsd, value.market.fdvUsd].some(amount => Number.isFinite(amount) && amount > 0));
      if (!markets.length) add(`${target.id}:market_data_missing`);
      else if (markets.every(value => age(value.market.observedAt, now) > MARKET_MAX_AGE_MS || age(value.market.observedAt, now) < -2 * 60_000)) add(`${target.id}:market_data_stale`, "warning");
    } else if (target.id === "api") {
      if (body.status !== "ready" || !commit.test(body.sourceCommit ?? "")) add("api:not_ready");
    } else if (target.id === "robinhood-api") {
      if (body.mode !== "active" || body.readsReady !== true || body.finalityReady !== true || body.sourceWorkerReady !== true
        || !commit.test(body.sourceCommit ?? "")) add("robinhood-api:not_active");
    } else if (body.mode !== "active" || body.ready !== true) add("base-api:not_active");
  }
  return { issues: issues.sort((a, b) => a.code.localeCompare(b.code)), summary };
}

export function advanceIncidentState(previous, issues, now = Date.now()) {
  if (previous && (previous.schemaVersion !== 1 || !Array.isArray(previous.incidents))) throw Error("Invalid monitor state");
  const prior = new Map((previous?.incidents ?? []).map(item => [item.code, item]));
  const current = new Map(issues.map(item => [item.code, item]));
  const incidents = [];
  const opened = [], recovered = [];
  for (const code of new Set([...prior.keys(), ...current.keys()])) {
    const old = prior.get(code), issue = current.get(code);
    if (issue) {
      const count = (old?.badRuns ?? 0) + 1;
      const active = Boolean(old?.active) || count >= 2;
      incidents.push({ code, severity: issue.severity, active, badRuns: count, goodRuns: 0, firstSeen: old?.firstSeen ?? new Date(now).toISOString() });
      if (active && !old?.active) opened.push(issue);
    } else if (old?.active) {
      const count = (old.goodRuns ?? 0) + 1;
      if (count >= 2) recovered.push({ code, severity: old.severity });
      else incidents.push({ ...old, badRuns: 0, goodRuns: count });
    }
  }
  return { state: { schemaVersion: 1, checkedAt: new Date(now).toISOString(), incidents }, opened, recovered };
}

export async function runMonitor(stateDirectory, request = fetch) {
  if (!isAbsolute(stateDirectory)) throw Error("State directory must be absolute");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const lock = join(stateDirectory, "check.lock");
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let lockAge;
    try { lockAge = Date.now() - (await stat(lock)).mtimeMs; }
    catch (next) { if (next.code === "ENOENT") return { status: "busy", notify: false }; throw next; }
    if (lockAge < 5 * 60_000) return { status: "busy", notify: false };
    // Never delete a lock that another process might own. Surface a crashed
    // monitor separately instead of silently disabling all future checks.
    return { status: "monitor_error", notify: true, issues: [{ code: "monitor:stale_lock", severity: "error" }] };
  }
  const stateFile = join(stateDirectory, "state.json");
  const temporary = join(stateDirectory, `.state-${randomUUID()}.json`);
  try {
    let previous;
    try { previous = JSON.parse(await readFile(stateFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const observations = await collectObservations(request);
    const { issues, summary } = assessHealth(observations);
    const transition = advanceIncidentState(previous, issues);
    await writeFile(temporary, JSON.stringify(transition.state, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, stateFile);
    const result = { checkedAt: transition.state.checkedAt, status: issues.length ? "degraded" : "ok",
      notify: Boolean(transition.opened.length || transition.recovered.length), requests: observations.length,
      opened: transition.opened, recovered: transition.recovered, issues, summary };
    await writeFile(join(stateDirectory, "latest.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    return result;
  } finally { await rm(temporary, { force: true }); await rm(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { "state-dir": { type: "string", default: join(homedir(), ".programmable", "production-health") } } });
  try { console.log(JSON.stringify(await runMonitor(values["state-dir"]))); }
  catch { console.error("Production health check failed; inspect the local state directory."); process.exitCode = 1; }
}
