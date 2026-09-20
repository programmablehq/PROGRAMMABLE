import { configuredFoundationSources, type FoundationIndexInventory } from "@/lib/server/robinhood-index/foundation-source";
import { timingSafeEqual } from "node:crypto";
import { robinhoodSource } from "@/lib/server/robinhood-index/source";
import { indexStore } from "@/lib/server/robinhood-index/store";
import { configuredModuleModeSources, type ModuleModeUnavailableSource } from "@/lib/server/robinhood-index/module-source";
import { moduleModeSnapshots } from "@/lib/server/robinhood-index/model";
import { syncRobinhoodIndex, syncModuleModeIndex } from "@/lib/server/robinhood-index/sync";
import { launchProjectionSourceV1, syncLaunchProjectionIndex } from "@/lib/server/robinhood-index/launch-projection-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
type ModuleLaneResult = Awaited<ReturnType<typeof syncModuleModeIndex>> | { status: "disabled" | "unavailable" };

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get("authorization");
  const authorized = expected && expected.length >= 32 && expected.length <= 1024 && actual
    && Buffer.byteLength(actual) === Buffer.byteLength(`Bearer ${expected}`)
    && timingSafeEqual(Buffer.from(actual), Buffer.from(`Bearer ${expected}`));
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: {
    "cache-control": "no-store", "x-content-type-options": "nosniff",
  } });
  if (!authorized) return reply({ error: "unauthorized" }, 401);
  if (new URL(request.url).search || request.body) return reply({ error: "invalid_request" }, 400);
  const startedAt = Date.now();
  try {
    const store = indexStore();
    let result: Awaited<ReturnType<typeof syncRobinhoodIndex>> | null = null;
    try { result = await syncRobinhoodIndex(await robinhoodSource(), store); }
    catch { /* A failed Custom source must not suppress independent Module Mode verification. */ }
    let launchProjections: Awaited<ReturnType<typeof syncLaunchProjectionIndex>> | { status: "unavailable" } = { status: "unavailable" };
    const projectionBudget = Math.min(45000, Math.max(1, 165000 - (Date.now() - startedAt)));
    try { launchProjections = await syncLaunchProjectionIndex(launchProjectionSourceV1(AbortSignal.timeout(projectionBudget)), store); }
    catch { /* Keep the previous verified rows and retry this source on the next scheduled pass. */ }
    // Keep a genuine rollup proof inside the job's wall-clock budget. A deadline is an error,
    // never permission to publish a partial proof or skip the final canonical checkpoint read.
    const remaining = 165_000 - (Date.now() - startedAt);
    let moduleMode: ModuleLaneResult = { status: "unavailable" };
    const moduleSources: Record<string, ModuleLaneResult> = {};
    let moduleUnavailableSources: readonly ModuleModeUnavailableSource[] = [];
    const foundationSources: Record<string, ModuleLaneResult> = {};
    let foundationUnavailableSources: FoundationIndexInventory["unavailableSources"] = [];
    let foundation: "ready" | "syncing" | "partial" | "disabled" | "unavailable" = "unavailable";
    if (remaining > 0) {
      const inventorySignal = AbortSignal.timeout(remaining);
      const [modules, foundations] = await Promise.allSettled([
        configuredModuleModeSources(undefined, inventorySignal), configuredFoundationSources(inventorySignal),
      ]);
      const moduleLanes = modules.status === "fulfilled" ? modules.value.lanes : [];
      const foundationLanes = foundations.status === "fulfilled" ? foundations.value.lanes : [];
      moduleUnavailableSources = modules.status === "fulfilled" ? modules.value.unavailableSources : [];
      foundationUnavailableSources = foundations.status === "fulfilled" ? foundations.value.unavailableSources : ["FOUNDATION_RELEASE_INVENTORY_UNAVAILABLE"];
      const primary = moduleLanes[0]?.releaseDigest;
      // All source generations share the existing checkpoint scheduler. The oldest lane goes first,
      // so a slow provider or a newly admitted factory cannot permanently starve another generation.
      const saved = await store.read();
      const histories = moduleModeSnapshots(saved?.snapshot ?? null);
      const ages = new Map(histories.map(source => [source.releaseDigest.toLowerCase(), Date.parse(source.updatedAt)]));
      const lanes = [...moduleLanes.map(lane => ({ ...lane, foundation: false })),
        ...foundationLanes.map(lane => ({ ...lane, foundation: true }))];
      for (const source of histories) {
        if (!lanes.some(lane => lane.releaseDigest.toLowerCase() === source.releaseDigest.toLowerCase())) {
          (source.sourceKind === "module-foundation-v1" ? foundationSources : moduleSources)[source.releaseDigest] = { status: "unavailable" };
        }
      }
      const ordered = lanes.sort((a, b) => (ages.get(a.releaseDigest.toLowerCase()) ?? 0) - (ages.get(b.releaseDigest.toLowerCase()) ?? 0));
      for (const [index, lane] of ordered.entries()) {
        const results = lane.foundation ? foundationSources : moduleSources;
        results[lane.releaseDigest] = { status: "unavailable" };
        const budget = 165_000 - (Date.now() - startedAt);
        if (budget <= 0) continue;
        try {
          const laneBudget = Math.max(1, Math.floor(budget / (ordered.length - index)));
          const laneDeadline = Date.now() + laneBudget;
          const source = await lane.source(AbortSignal.timeout(laneBudget));
          results[lane.releaseDigest] = await syncModuleModeIndex(source, store, {
            ...(lane.foundation ? { rangeSize: 5_000n } : {}),
            // Leave time for the final canonical checkpoint read and the shared CAS write.
            budgetMs: Math.max(0, Math.min(90_000, laneDeadline - Date.now() - 8_000)),
          });
        } catch { /* Retain this generation's verified history and let the remaining sources progress. */ }
      }
      moduleMode = primary ? moduleSources[primary] : { status: modules.status === "fulfilled" ? "disabled" : "unavailable" };
      const states = Object.values(foundationSources).map(source => source.status);
      foundation = foundationUnavailableSources.length || states.includes("unavailable") ? "unavailable"
        : states.includes("partial") ? "partial" : states.includes("syncing") ? "syncing" : states.length ? "ready" : "disabled";
    }
    const failed = result === null || result.status === "partial" || launchProjections.status === "unavailable" || launchProjections.status === "partial" || moduleMode.status === "partial" || moduleMode.status === "unavailable"
      || foundation === "unavailable" || foundation === "partial" || moduleUnavailableSources.length > 0 || Object.values(moduleSources).some(source => source.status === "partial" || source.status === "unavailable");
    return reply({ ...(result ?? { error: "index_update_unavailable" }),
      custom: result ?? { status: "unavailable" }, launchProjections, moduleMode, moduleSources, moduleUnavailableSources, foundation, foundationSources, foundationUnavailableSources }, failed ? 503 : 200);
  } catch { return reply({ error: "index_update_unavailable" }, 503); }
}
