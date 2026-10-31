import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createAIStore, CUSTOM_AI_SCHEMA, type AIStore } from "../lib/custom-ai/store.server";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import { compileContractProject, type CompiledProject } from "../lib/custom-ai/contract-project.server";
import { checkGeneralScenarios, type GeneralScenarioReport } from "../lib/custom-ai/behavior-checks.server";
import { createGeneralCheckBlueprint, bindGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import { conversationStorageId } from "../lib/custom-ai/conversation.server";
import { generalProjectView } from "../lib/custom-ai/project-view";
import { selectExecutionRoute } from "../lib/custom-ai/execution-routing";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type { StudioState } from "../lib/custom-ai/studio";
import type { GeneralLaunchSourceSelection } from "../lib/custom-ai/general-launch-source.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";

const owner = "alice", account = `0x${"11".repeat(20)}`, chat = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = "checked-general-source-0001", storageId = conversationStorageId(account, chat);
const intent: LaunchIntent = { version: 1, id: "marker-design", revision: "a".repeat(64), changes: [], unresolved: [],
  requirements: [{ id: "marker", text: "The marker returns one", kind: "behavior", origin: { kind: "legacy" }, open: null }] };
const production = projectLaunchProductionContext(captured.chains["999"], 999, protection);
const blueprint = createGeneralCheckBlueprint({ contracts: [{ id: "marker", source: "Marker.sol", contract: "Marker", role: "auxiliary", arguments: [],
  functions: ["function marker() pure returns (uint256)"], allowReceive: false, allowFallback: false, surfaceRequirements: [] }], allowedCalls: [],
  steps: [{ id: "one", contract: "marker", signature: "marker()", arguments: [], from: "trader-a", afterSeconds: 0, value: "0", read: true,
    requirementIds: ["marker"], expect: { status: "success", returns: ["1"] } }] }, intent, 999, "paris", production);
const project = createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "paris" },
  sources: { "Marker.sol": { content: "pragma solidity 0.8.26; contract Marker { function marker() external pure returns (uint256) { return 1; } }" } },
  entrypoints: [{ source: "Marker.sol", contract: "Marker", role: "auxiliary" }] }, intent, 999, production);
let compilation: CompiledProject, scenarios: GeneralScenarioReport, database: PGlite, store: AIStore, state: StudioState, revision: number;
beforeAll(async () => {
  // One actual local compile/EVM qualification for the immutable receipt used by
  // the ownership tests. No model, RPC, API key, issuer or wallet is involved.
  compilation = await compileContractProject(project);
  expect(compilation.compiled).toBe(true);
  scenarios = await checkGeneralScenarios(project, compilation, bindGeneralCheckBlueprint(blueprint, project));
  expect(scenarios.passed).toBe(true);
}, 60_000);
beforeEach(async () => {
  database = new PGlite(); await database.exec(CUSTOM_AI_SCHEMA);
  let queue = Promise.resolve();
  store = createAIStore({ connect: async () => {
    const prior = queue; let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; }); await prior;
    return { query: (sql, values) => database.query<Record<string, unknown>>(sql, values), release };
  } }, { hourlyUnits: 100, dailyUnits: 100, globalDailyUnits: 100, concurrent: 2 });
  await store.conversations.create(owner, account, chat);
  const settings = { ...EMPTY_COIN_SETUP, chainId: 999 as const, name: "Marker", symbol: "MARK" };
  revision = await store.saveObject(owner, "studio", storageId, { settings, messages: [] }, 0);
  const attempt = await store.reserve(owner, { id, intent: "build", messages: [{ role: "user", content: "Build the agreed marker." }],
    conversation: { account, id: chat, revision } });
  await store.projects.saveBlueprint(owner, id, attempt.lease!, { intent, blueprint });
  await store.projects.save(owner, id, attempt.lease!, project);
  await store.projects.complete(owner, id, attempt.lease!, compilation);
  await store.projects.saveScenarios(owner, id, attempt.lease!, scenarios);
  const view = generalProjectView({ version: 1, reply: "Source checked", summary: "Marker", project, compilation, scenarios,
    blueprintId: blueprint.id, selection: selectExecutionRoute(intent, 999), requirementCoverage: "proposed", launchReady: false });
  await store.finish(owner, id, attempt.lease!, { reply: "Source checked", generalProject: view, intent, change: "applied" });
  state = { settings, messages: [], draftId: id, sourceId: id, contextId: id };
  revision = await store.saveObject(owner, "studio", storageId, state, revision);
});
afterEach(async () => { await database?.close(); });
const selection = (): GeneralLaunchSourceSelection => ({ id, account, conversation: chat, studioRevision: revision, chainId: 999,
  projectHash: project.hash, artifactHash: compilation.artifactHash, intentRevision: intent.revision });

describe("current owned source selection before general launch packing", () => {
  it("loads actual checked source, oracle and artifacts in one private snapshot without creating a launch", async () => {
    const before = (await database.query("SELECT owner,kind,id,revision FROM programmable_custom_ai_v1.objects ORDER BY kind,id")).rows;
    const first = await store.projects.readForLaunch(owner, selection()), second = await store.projects.readForLaunch(owner, selection());
    expect(first.bindingHash).toBe(second.bindingHash); expect(first.project).toEqual(project);
    expect(first.compilation.artifactHash).toBe(compilation.artifactHash); expect(first.scenarios.hash).toBe(scenarios.hash);
    expect(first.project.production?.id).toBe(production.id); expect(first.blueprint.production?.id).toBe(production.id);
    expect(first.binding).toMatchObject({ account, conversation: chat, sourceId: id, contextId: id, chainId: 999 });
    expect(first.launchReady).toBe(false);
    expect((await database.query("SELECT owner,kind,id,revision FROM programmable_custom_ai_v1.objects ORDER BY kind,id")).rows).toEqual(before);
  });

  it("rejects another owner, wallet, chat, selected source or chain without adopting an old studio", async () => {
    await expect(store.projects.readForLaunch("bob", selection())).rejects.toMatchObject({ code: "launch-source-changed" });
    for (const patch of [{ account: `0x${"22".repeat(20)}` }, { conversation: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { id: "another-checked-source-0001" }, { chainId: 1 as const }])
      await expect(store.projects.readForLaunch(owner, { ...selection(), ...patch })).rejects.toMatchObject({ code: "launch-source-changed" });
  });

  it("rejects a stale tab, pending design change and archived chat while preserving the checked source", async () => {
    await expect(store.projects.readForLaunch(owner, { ...selection(), studioRevision: revision - 1 })).rejects.toMatchObject({ code: "launch-source-changed" });
    revision = await store.saveObject(owner, "studio", storageId, { ...state, pendingChange: "Change the marker to two" }, revision);
    await expect(store.projects.readForLaunch(owner, selection())).rejects.toMatchObject({ code: "launch-source-changed" });
    revision = await store.saveObject(owner, "studio", storageId, state, revision);
    const chatState = await store.conversations.read(owner, account, chat);
    await store.conversations.update(owner, account, chat, chatState!.revision, { archived: true });
    await expect(store.projects.readForLaunch(owner, selection())).rejects.toMatchObject({ code: "launch-source-changed" });
    expect((await store.projects.read(owner, id))?.project.hash).toBe(project.hash);
  });

  it("blocks an in-flight newer conversation request before treating the old working source as current", async () => {
    await store.reserve(owner, { id: "pending-general-change-0001", intent: "chat", draftId: id, contextId: id,
      messages: [{ role: "user", content: "Change the marker to two." }], conversation: { account, id: chat, revision } });
    await expect(store.projects.readForLaunch(owner, selection())).rejects.toMatchObject({ code: "launch-source-changed" });
  });

  it("requires the complete latest intent even when a newer answer keeps the old working source", async () => {
    const nextId = "finished-general-change-0001", nextIntent = { ...intent, revision: "b".repeat(64),
      requirements: [{ ...intent.requirements[0], text: "The marker returns two" }] };
    const next = await store.reserve(owner, { id: nextId, intent: "chat", draftId: id, contextId: id,
      messages: [{ role: "user", content: "Change the marker to two." }], conversation: { account, id: chat, revision } });
    await store.finish(owner, nextId, next.lease!, { reply: "The requested design is now two.", intent: nextIntent, change: "unchanged" });
    revision = await store.saveObject(owner, "studio", storageId, { ...state, contextId: nextId }, revision);
    await expect(store.projects.readForLaunch(owner, selection())).rejects.toMatchObject({ code: "launch-source-changed" });
  });

  it("allows an unsent-text-only revision during async preparation only with the unchanged semantic binding", async () => {
    const original = selection(), checked = await store.projects.readForLaunch(owner, original);
    revision = await store.saveObject(owner, "studio", storageId, { ...state, input: "An unsent message" }, revision);
    await expect(store.projects.readForLaunch(owner, original)).rejects.toMatchObject({ code: "launch-source-changed" });
    expect((await store.projects.readForLaunch(owner, { ...original, bindingHash: checked.bindingHash })).bindingHash).toBe(checked.bindingHash);
    revision = await store.saveObject(owner, "studio", storageId, { ...state, settings: { ...state.settings, name: "Changed name" } }, revision);
    await expect(store.projects.readForLaunch(owner, { ...original, bindingHash: checked.bindingHash })).rejects.toMatchObject({ code: "launch-source-changed" });
  });

  it("rejects source or artifact identity substitutions and an altered scenario report", async () => {
    await expect(store.projects.readForLaunch(owner, { ...selection(), projectHash: `sha256:${"1".repeat(64)}` })).rejects.toMatchObject({ code: "launch-source-changed" });
    await expect(store.projects.readForLaunch(owner, { ...selection(), artifactHash: `sha256:${"2".repeat(64)}` })).rejects.toMatchObject({ code: "launch-source-checks" });
    await database.query(`UPDATE programmable_custom_ai_v1.objects SET value=jsonb_set(value,'{scenarios,hash}',$3::jsonb)
      WHERE owner=$1 AND kind='contract-project' AND id=$2`, [owner, id, JSON.stringify(`sha256:${"3".repeat(64)}`)]);
    await expect(store.projects.readForLaunch(owner, selection())).rejects.toMatchObject({ code: "launch-source-checks" });
  });

  it("does not use a missing original oracle or a legacy unbound job as preparation evidence", async () => {
    await database.query(`UPDATE programmable_custom_ai_v1.jobs SET request=request-'conversation' WHERE owner=$1 AND id=$2`, [owner, id]);
    await expect(store.projects.readForLaunch(owner, selection())).rejects.toMatchObject({ code: "launch-source-changed" });
    await database.query(`DELETE FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='contract-check-blueprint' AND id=$2`, [owner, id]);
    await expect(store.projects.readForLaunch(owner, selection())).rejects.toMatchObject({ code: "launch-source-checks" });
  });
});
