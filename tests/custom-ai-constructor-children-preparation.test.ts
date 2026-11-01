import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { generalPackFixture } from "./fixtures/custom-ai-general-pack";
import { createAIStore, CUSTOM_AI_SCHEMA, type AIStore } from "../lib/custom-ai/store.server";
import { conversationStorageId } from "../lib/custom-ai/conversation.server";
import { generalProjectView } from "../lib/custom-ai/project-view";
import { selectExecutionRoute } from "../lib/custom-ai/execution-routing";
import { packGeneralGraph } from "../lib/custom-ai/general-pack.server";
import { packGeneralRobinhoodPlan } from "../lib/custom-ai/general-plan-pack.server";
import { createGeneralPublicSource, generalSourcePublicUri } from "../lib/custom-ai/public-launch-source.server";
import { generalPreparationView, type GeneralPackedLaunch, type GeneralPreparation } from "../lib/custom-ai/general-preparation-store.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";

const owner = "pack-fixture-owner", ticket = "child-preparation-ticket-0001", tables = ["jobs", "objects", "budgets"] as const;
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR).each([8453, 4663] as const)("durable chain %s child-source preparation", chain => {
  let fixture: Awaited<ReturnType<typeof generalPackFixture>>, pack: GeneralPackedLaunch, record: GeneralPreparation;
  let db: PGlite, store: AIStore, clock: number, initialClock: number, snapshot: Record<string, Record<string, unknown>[]>;
  function makeStore(database: PGlite) {
    let queue = Promise.resolve();
    return createAIStore({ connect: async () => {
      const prior = queue; let release!: () => void; queue = new Promise<void>(resolve => { release = resolve; }); await prior;
      return { query: (sql, values) => database.query<Record<string, unknown>>(sql, values), release };
    } }, { hourlyUnits: 100, dailyUnits: 100, globalDailyUnits: 100, concurrent: 2 }, () => clock);
  }
  beforeAll(async () => {
    initialClock = clock = Date.now(); fixture = await generalPackFixture(chain, false, 0, true);
    const database = new PGlite(); await database.exec(CUSTOM_AI_SCHEMA); const seed = makeStore(database), source = fixture.source, binding = source.binding;
    await seed.conversations.create(owner, fixture.controller, binding.conversation);
    const key = conversationStorageId(fixture.controller, binding.conversation);
    let revision = await seed.saveObject(owner, "studio", key, { settings: binding.settings, image: binding.image, messages: [] }, 0);
    const reserved = await seed.reserve(owner, { id: binding.sourceId, intent: "build", messages: [{ role: "user", content: "Private child source conversation" }],
      conversation: { account: fixture.controller, id: binding.conversation, revision } });
    await seed.projects.saveBlueprint(owner, binding.sourceId, reserved.lease!, { intent: source.project.intent, blueprint: source.blueprint });
    await seed.projects.save(owner, binding.sourceId, reserved.lease!, source.project);
    await seed.projects.complete(owner, binding.sourceId, reserved.lease!, source.compilation);
    await seed.projects.saveScenarios(owner, binding.sourceId, reserved.lease!, source.scenarios);
    const view = generalProjectView({ version: 1, reply: "Source checked", summary: "Observed children", project: source.project, compilation: source.compilation, scenarios: source.scenarios,
      blueprintId: source.blueprint.id, selection: selectExecutionRoute(source.project.intent, chain), requirementCoverage: "proposed", launchReady: false });
    await seed.finish(owner, binding.sourceId, reserved.lease!, { reply: "Source checked", generalProject: view, intent: source.project.intent, change: "applied" });
    revision = await seed.saveObject(owner, "studio", key, { settings: binding.settings, image: binding.image, messages: [], draftId: binding.sourceId, sourceId: binding.sourceId, contextId: binding.contextId }, revision);
    const selected = { id: binding.sourceId, account: fixture.controller, conversation: binding.conversation, studioRevision: revision, chainId: chain,
      projectHash: source.project.hash, artifactHash: source.compilation.artifactHash, intentRevision: binding.intentRevision };
    const preparation = await seed.projects.preparations.reserve(owner, ticket, selected, undefined, chain === 4663 ? "eoa" : undefined);
    record = preparation.record; fixture.source = preparation.source!; fixture.exported = createGeneralPublicSource(fixture.source); fixture.url = generalSourcePublicUri(fixture.exported.id);
    pack = chain === 4663 ? await packGeneralRobinhoodPlan({ ...fixture, identity: record.identity }, { address: fixture.controller, kind: "eoa" }) : await packGeneralGraph({ ...fixture, identity: record.identity });
    snapshot = {}; for (const table of tables) snapshot[table] = (await database.query<Record<string, unknown>>(`SELECT * FROM programmable_custom_ai_v1.${table}`)).rows;
    await database.close();
  }, 120_000);
  beforeEach(async () => {
    clock = initialClock; db = new PGlite(); await db.exec(CUSTOM_AI_SCHEMA);
    for (const table of tables) await db.query(`INSERT INTO programmable_custom_ai_v1.${table} SELECT * FROM jsonb_populate_recordset(NULL::programmable_custom_ai_v1.${table},$1::jsonb)`, [JSON.stringify(snapshot[table])]);
    store = makeStore(db);
  });
  afterEach(async () => { await db?.close(); });
  it("persists the complete receipt and replays the same original bytes after an unknown submission and reload", async () => {
    const saved = await store.projects.preparations.completePack(owner, ticket, record.packLease.token, pack);
    expect(saved.packState).toBe("complete");
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toBeNull();
    const compact = JSON.stringify(generalPreparationView(saved, clock));
    for (const field of ["constructorMaterialization", "constructorChildren", "requestBody", "idempotencyKey"]) expect(compact).not.toContain(field);
    const first = await store.projects.preparations.claimExchange(owner, ticket, "create", record.productionId);
    expect(first.pack).toEqual(pack);
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toEqual(fixture.exported);
    await store.projects.preparations.finishExchange(owner, ticket, "create", first.lease!, { state: "unknown", summary: { code: "RESPONSE_UNCONFIRMED" } });
    clock += 3 * 60 * 60 * 1000; store = makeStore(db);
    const again = await store.projects.preparations.claimExchange(owner, ticket, "create", record.productionId);
    expect(again.pack).toEqual(pack); expect(again.record.identity).toEqual(record.identity); expect(again.record.idempotencyKey).toBe(record.idempotencyKey);
    expect(again.record.submission!.attempts).toBe(2);
    expect((await db.query("SELECT id FROM programmable_custom_ai_v1.objects WHERE kind='general-prepare'")).rows).toHaveLength(1);
    expect(await store.projects.preparations.read("another-owner", ticket)).toBeNull();
  });
  it.each(["missing receipt", "inner hash", "downgrade", "partial children", "wrong address", "invalid parent"])("refuses %s even when the outer private-pack hash is recomputed", async reason => {
    const altered = JSON.parse(JSON.stringify(pack)), key = pack.route === "plan-v1" ? "runtimeMaterialization" : "constructorMaterialization";
    const runtime = altered[key];
    if (reason === "missing receipt") delete altered[key];
    if (reason === "inner hash") runtime.children[0].runtimeCodeHash = `0x${"44".repeat(32)}`;
    if (reason === "downgrade") altered.version = 1;
    if (reason === "partial children" || reason === "wrong address" || reason === "invalid parent") {
      if (reason === "partial children") runtime.children.pop();
      else if (reason === "invalid parent") runtime.targets.find((target: { id: string }) => target.id === "hook").address = "invalid";
      else { runtime.children[0].address = `0x${"55".repeat(20)}`; runtime.constructorChildren[0].address = runtime.children[0].address; }
      const { hash: discarded, ...body } = runtime; void discarded;
      runtime.hash = canonicalBrowserSha256V2("programmable.custom-ai-runtime-materialization.v2", body);
      if (pack.route === "plan-v1") altered.receipt.runtimeMaterializationHash = runtime.hash;
    }
    const { hash: discarded, ...body } = altered; void discarded;
    altered.hash = canonicalBrowserSha256V2(`programmable.custom-ai-general-${pack.route === "plan-v1" ? "plan" : "graph"}-pack.v${altered.version}`, body);
    await expect(store.projects.preparations.completePack(owner, ticket, record.packLease.token, altered)).rejects.toMatchObject({ code: "launch-preparation-storage" });
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toBeNull();
  });
});
