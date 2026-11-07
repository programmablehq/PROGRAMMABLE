import "server-only";
import type { AIPool } from "../store.server";
import { projectCompilerInput, type ContractProject } from "../contract-project";
import { validConversationId } from "../conversation";
import type { createPlatformStore } from "./project-store.server";
import { ProjectError, type JsonValue, type ProjectScope } from "./types";
import { validateScope } from "./document";

type LegacyImport = ProjectScope & { requestId: string; account: string; conversationId: string; linkedWallets: readonly string[] };

export function createLegacyProjectImporter(pool: AIPool, platform: ReturnType<typeof createPlatformStore>) {
  async function importProject(input: LegacyImport) {
    validateScope(input);
    if (!/^[A-Za-z0-9-]{16,64}$/.test(input.requestId) || !/^0x[a-f0-9]{40}$/i.test(input.account) || !validConversationId(input.conversationId)) {
      throw new ProjectError("project-input", "Choose a saved contract from your chat.");
    }
    if (!input.linkedWallets.some(wallet => wallet.toLowerCase() === input.account.toLowerCase())) {
      throw new ProjectError("project-wallet", "Select the wallet that owns the saved contract.", 403);
    }
    const db = await pool.connect();
    let project: ContractProject;
    try {
      const row = (await db.query(`SELECT o.value->'project' AS project FROM programmable_custom_ai_v1.objects o
        JOIN programmable_custom_ai_v1.jobs j ON j.owner=o.owner AND j.id=o.id AND j.payload_hash=o.value->>'payloadHash'
        WHERE o.owner=$1 AND o.kind='contract-project' AND o.id=$2
          AND lower(j.request->'conversation'->>'account')=$3 AND j.request->'conversation'->>'id'=$4`,
        [input.ownerId, input.requestId, input.account.toLowerCase(), input.conversationId.toLowerCase()])).rows[0];
      if (!row) throw new ProjectError("project-missing", "This saved contract was not found.", 404);
      project = row.project as ContractProject;
      try { projectCompilerInput(project); }
      catch { throw new ProjectError("legacy-source", "The saved source no longer matches its original revision.", 409); }
    } finally { db.release(); }

    const scope = { ownerId: input.ownerId, projectId: input.projectId };
    const existing = await platform.createProject(scope);
    const architecture = existing.document.architecture;
    if (architecture && typeof architecture === "object" && !Array.isArray(architecture)
      && architecture.sourceHash === project.hash && architecture.legacyRequestId === input.requestId) return existing;
    if (existing.ordinal !== 1 || existing.document.requirements.length || Object.keys(existing.document.files).length) {
      throw new ProjectError("project-conflict", "Import into a new project so existing work is preserved.", 409);
    }
    return platform.applyProjectPatch({ ...scope, expectedRevisionId: existing.revisionId, idempotencyKey: `legacy:${input.requestId}`, patch: {
      title: "Imported contract",
      requirements: structuredClone(project.intent.requirements),
      files: Object.fromEntries(Object.entries(project.sources).map(([name, value]) => [name, value.content])),
      dependencies: { solc: project.compiler.version },
      architecture: JSON.parse(JSON.stringify({ kind: "legacy-contract", chainId: project.chainId, compiler: project.compiler,
        entrypoints: project.entrypoints, sourceHash: project.hash, legacyRequestId: input.requestId,
        legacyConversationId: input.conversationId, legacyAccount: input.account.toLowerCase(), requiresVerification: true })) as JsonValue,
    } });
  }
  return { importProject };
}
