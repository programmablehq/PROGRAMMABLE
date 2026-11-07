import "server-only";
import type { createPlatformStore } from "./project-store.server";
import type { createSandboxExecutor } from "./sandbox-executor.server";
import type { createProjectChecks } from "./builds.server";
import { declaredProjectChecks } from "./builds.server";
import type { ProjectTool, ToolContext } from "./agent.server";
import { ProjectError, type JsonValue, type ProjectPatch } from "./types";
import { projectFileBytes, projectFileHash, projectFilePath } from "./files";
import { parseIntentRequirements, reviseLaunchIntent } from "../launch-intent.server";
import { parseRuleEdits } from "../design-edits";
import type { LaunchIntent } from "../launch-intent";
import {platformContractBlueprint} from "./contract-plan.server";
import {projectHash} from "./document";

const objectSchema = (properties: object, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const value = (input: JsonValue) => input as Record<string, JsonValue>;
const json = (input: unknown): JsonValue => JSON.parse(JSON.stringify(input)) as JsonValue;
export function createProjectTools(projects: ReturnType<typeof createPlatformStore>, sandbox: ReturnType<typeof createSandboxExecutor>, checks: ReturnType<typeof createProjectChecks>): ProjectTool[] {
  const save = async (context: ToolContext, patch: ProjectPatch) => {
    const revision = await projects.applyProjectPatch({ ownerId: context.ownerId, projectId: context.projectId, expectedRevisionId: context.revision.revisionId,
      idempotencyKey: context.stepId, execution: { runId: context.runId, leaseToken: context.leaseToken }, patch });
    return { revisionId: revision.revisionId };
  };
  const reconcile = (execute: ProjectTool["execute"]): ProjectTool["reconcile"] => async (context, input) => {
    const receipt = await projects.readPatchReceipt(context, context.stepId);
    return receipt ? { revisionId: receipt.revisionId } : execute(context, input);
  };
  const plan: ProjectTool = {
    id: "project.plan", version: "1", description: "Save the complete requirements and architecture. Keep every existing rule. Every new or changed requirement needs an exact quote from the latest user request. Define behavior checks in architecture.checks as {id,requirementIds,command,kind:'behavior'|'build'} before implementation.",
    schema: objectSchema({ title: { type: "string", maxLength: 120 }, requirements: { type: "array", maxItems: 64, items: objectSchema({
      id: { type: "string" }, text: { type: "string" }, kind: { enum: ["behavior", "constraint", "decision"] }, instruction: { type: "string" }, open: { type: ["string", "null"] },
    }) }, edits: { type: "array", items: objectSchema({ requirementId: { type: "string" }, operation: { enum: ["replace", "remove"] }, instruction: { type: "string" } }) }, architecture: { type: "object" } }),
    execute: async (context, input) => {
      const data = value(input), previous: LaunchIntent | undefined = context.revision.document.requirements.length ? {
        version: 1, id: context.projectId, revision: context.revision.requirementsHash.slice(7), requirements: context.revision.document.requirements,
        unresolved: context.revision.document.requirements.flatMap(rule => rule.open ? [rule.open] : []), changes: [],
      } : undefined;
      const proposed = parseIntentRequirements(data.requirements), edits = parseRuleEdits(data.edits, context.prompt);
      const interpreted = reviseLaunchIntent({ previous, proposed, edits, unresolved: proposed.flatMap(rule => rule.open ? [rule.open] : []),
        request: { id: context.runId, intent: "chat", messages: [{ role: "user", content: context.prompt }] } });
      if (interpreted.problems.length) throw new ProjectError("project-requirements", "The plan omitted or changed a saved rule without support from the latest request.", 409);
      const priorArchitecture = context.revision.document.architecture;
      const architecture = { ...(priorArchitecture && typeof priorArchitecture === "object" && !Array.isArray(priorArchitecture) ? priorArchitecture : {}), ...value(data.architecture) };
      if(["contract","legacy-contract"].includes(String(architecture.kind))&&!interpreted.intent.requirements.some(rule=>rule.open))platformContractBlueprint({projectId:context.projectId,requirementsHash:projectHash(interpreted.intent.requirements),document:{...context.revision.document,requirements:interpreted.intent.requirements,architecture}});
      return save(context, { title: data.title as string, requirements: interpreted.intent.requirements, architecture,
        removeRequirementIds: context.revision.document.requirements.filter(rule => !interpreted.intent.requirements.some(item => item.id === rule.id)).map(rule => rule.id) });
    },
  };
  plan.reconcile = reconcile(plan.execute);
  const patch: ProjectTool = {
    id: "project.patch", version: "1", description: "Apply exact file changes. Each write/delete needs the file's previous hash, or null for a new file. Read the file first. Files not named are preserved. This does not verify or deploy.",
    schema: objectSchema({ fileChanges: { type: "array", minItems: 1, maxItems: 64, items: { anyOf: [
      objectSchema({ operation: { const: "write" }, path: { type: "string" }, beforeHash: { type: ["string", "null"] }, content: { anyOf: [{ type: "string" }, objectSchema({ encoding: { const: "base64" }, content: { type: "string" }, mediaType: { type: "string" } })] } }),
      objectSchema({ operation: { const: "delete" }, path: { type: "string" }, beforeHash: { type: "string" } }),
    ] } } }),
    execute: async (context, input) => {
      if (context.revision.document.requirements.some(rule => rule.open)) throw new ProjectError("project-open", "Resolve the open requirements before implementing.", 409);
      if (!context.revision.document.requirements.length) throw new ProjectError("project-plan", "Save the requirements before implementing.", 409);
      const architecture = context.revision.document.architecture;
      const contract = architecture && typeof architecture === "object" && !Array.isArray(architecture) && ["contract", "legacy-contract"].includes(String(architecture.kind));
      if(contract)platformContractBlueprint(context.revision);
      if (!contract && !declaredProjectChecks(architecture, context.revision.document.requirements.map(rule => rule.id)).length) throw new ProjectError("project-check-plan", "Declare the required behavior checks in the project plan before implementing.", 409);
      return save(context, value(input) as ProjectPatch);
    },
  };
  patch.reconcile = reconcile(patch.execute);
  const dependencies: ProjectTool = {
    id: "project.dependencies", version: "1", description: "Resolve package.json dependencies into a saved npm lock in an isolated sandbox. Does not run package lifecycle scripts or application code.", schema: objectSchema({}),
    execute: async context => {
      const result = await sandbox.execute({ ...context, revisionId: context.revision.revisionId, script: "true", outputPaths: ["package-lock.json"], resolveDependencies: true }, context.signal);
      if (result.exitCode || typeof result.files["package-lock.json"] !== "string") throw new ProjectError("project-dependencies", "Dependency resolution did not produce a complete lock.", 409);
      const previous = context.revision.document.files["package-lock.json"];
      return save(context, { fileChanges: [{ operation: "write", path: "package-lock.json", beforeHash: previous === undefined ? null : projectFileHash(previous), content: result.files["package-lock.json"] }] });
    },
  };
  dependencies.reconcile = reconcile(dependencies.execute);
  return [
    { id: "project.read", version: "1", description: "Read selected source files and their hashes. An empty paths array returns the project plan and file inventory.", schema: objectSchema({ paths: { type: "array", maxItems: 20, items: { type: "string" } } }),
      execute: async (context, input) => {
        const files: Record<string, JsonValue> = {}; let size = 0;
        for (const raw of value(input).paths as string[]) {
          const path = projectFilePath(raw), file = context.revision.document.files[path];
          if (file === undefined) continue;
          size += projectFileBytes(file).length;
          if (size > 120000) throw new ProjectError("project-read-limit", "Read fewer files at a time.", 413);
          files[path] = { content: json(file), hash: projectFileHash(file) };
        }
        return json({ revisionId: context.revision.revisionId, requirements: context.revision.document.requirements, architecture: context.revision.document.architecture, files,
          inventory: Object.entries(context.revision.document.files).map(([path, file]) => ({ path, hash: projectFileHash(file), bytes: projectFileBytes(file).length })) });
      } },
    plan, patch, dependencies,
    { id: "project.check", version: "1", description: "Run the predeclared build and behavior checks on the exact saved revision; record evidence per requirement. Compilation alone cannot verify behavior.", schema: objectSchema({}),
      execute: async context => json(await checks.verify({ ...context, revisionId: context.revision.revisionId }, context.signal)) },
    { id: "sandbox.command", version: "1", description: "Inspect or debug the saved revision using a command in an isolated VM. Network is blocked except locked dependency installation. Returned files do not change the project until explicitly saved with project.patch. This is diagnostic output, not release evidence.",
      schema: objectSchema({ script: { type: "string", minLength: 1, maxLength: 16000 }, outputPaths: { type: "array", maxItems: 16, items: { type: "string" } } }),
      execute: async (context, input) => json(await sandbox.execute({ ...context, revisionId: context.revision.revisionId, script: value(input).script as string, outputPaths: value(input).outputPaths as string[] }, context.signal)) },
  ];
}

