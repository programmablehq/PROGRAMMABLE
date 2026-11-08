import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createLegacyProjectImporter } from "../lib/custom-ai/platform/legacy-adapter.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import { createAIStore, CUSTOM_AI_SCHEMA, type AIPool } from "../lib/custom-ai/store.server";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";

const ownerId = "alice", requestId = "00000000-0000-4000-8000-000000000001";
const account = "0x1000000000000000000000000000000000000001", conversationId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const source = createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "paris" },
  sources: { "Hook.sol": { content: "pragma solidity 0.8.26; contract Hook {}" } }, entrypoints: [{ source: "Hook.sol", contract: "Hook", role: "hook" }] },
  { version: 1, id: "design", revision: "a".repeat(64), changes: [], unresolved: [], requirements: [
    { id: "no-mint", text: "No minting", kind: "constraint", open: null, origin: { kind: "legacy" } },
    { id: "cooldown", text: "Keep the cooldown", kind: "behavior", open: null, origin: { kind: "legacy" } },
  ] }, 999);
const input = { ownerId, projectId, requestId, account, conversationId, linkedWallets: [account] };
let db: PGlite, platform: ReturnType<typeof createPlatformStore>, importer: ReturnType<typeof createLegacyProjectImporter>;
beforeEach(async () => {
  db = new PGlite(); await db.exec(CUSTOM_AI_SCHEMA); await db.exec(PROJECT_PLATFORM_SCHEMA);
  let tail = Promise.resolve();
  const pool: AIPool = { connect: async () => {
    const prior = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    return { query: (sql, values) => db.query<Record<string, unknown>>(sql, values), release };
  } };
  const legacy = createAIStore(pool, { hourlyUnits: 25, dailyUnits: 100, globalDailyUnits: 100, concurrent: 1 });
  await legacy.conversations.create(ownerId, account, conversationId);
  const reserved = await legacy.reserve(ownerId, { id: requestId, intent: "build", conversation: { id: conversationId, account, revision: 0 }, messages: [{ role: "user", content: "Build this hook" }] });
  await legacy.projects.save(ownerId, requestId, reserved.lease!, source);
  platform = createPlatformStore(pool); importer = createLegacyProjectImporter(pool, platform);
});
afterEach(async () => { await db.close(); });

describe("legacy project adoption", () => {
  it("preserves every requirement and source file without editing the legacy checkpoint", async () => {
    const before = await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='alice' AND kind='contract-project'");
    const saved = await importer.importProject(input);
    expect(saved.document.requirements).toEqual(source.intent.requirements);
    expect(saved.document.files).toEqual({ "Hook.sol": source.sources["Hook.sol"].content });
    expect(saved.document.architecture).toMatchObject({ sourceHash: source.hash, requiresVerification: true });
    expect(await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='alice' AND kind='contract-project'")).toEqual(before);
  });
  it("rejects a foreign owner, a different chat and an unlinked wallet", async () => {
    await expect(importer.importProject({ ...input, ownerId: "bob" })).rejects.toMatchObject({ status: 404 });
    await expect(importer.importProject({ ...input, conversationId: "44444444-4444-4444-8444-444444444444" })).rejects.toMatchObject({ status: 404 });
    await expect(importer.importProject({ ...input, linkedWallets: [] })).rejects.toMatchObject({ status: 403 });
    expect(await platform.listProjects(ownerId)).toEqual([]);
  });
  it("does not overwrite later changes when import is repeated", async () => {
    const first = await importer.importProject(input);
    const updated = await platform.applyProjectPatch({ ownerId, projectId, expectedRevisionId: first.revisionId, idempotencyKey: "rename-import", patch: { title: "Edited project" } });
    expect(await importer.importProject(input)).toEqual(updated);
  });
  it("rejects source whose stored hash no longer matches its contents", async () => {
    await db.query("UPDATE programmable_custom_ai_v1.objects SET value=jsonb_set(value,'{project,sources,Hook.sol,content}',to_jsonb('contract Changed {}'::text)) WHERE owner='alice' AND kind='contract-project'");
    await expect(importer.importProject(input)).rejects.toMatchObject({ code: "legacy-source", status: 409 });
    expect(await platform.listProjects(ownerId)).toEqual([]);
  });
});
