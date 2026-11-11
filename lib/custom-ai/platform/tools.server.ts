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
import {platformContractBlueprint,completeCanonicalContractInterfaces,assertCanonicalReferenceChanges} from "./contract-plan.server";
import {projectHash} from "./document";
import {readLaunchBuildContext} from "../launch-production.server";
import {applyPlanArchitectureUpdates} from "./plan-edits";
import {projectRequirementScopes} from "./requirement-scopes";
import {builderChains,type BuilderChainId} from "../execution-routing";
import {assertSavedCheckPlan} from "./check-plan-guard";

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
    id: "project.plan", version: "1", description: "Save the complete requirements and either a full architecture or bounded architectureUpdates against the current saved architecture. Updates use exact string path segments, operation set/remove and a value for set; array positions are zero-based strings. Unmentioned fields are preserved. Keep every existing rule and expected check. First plans require architecture. Changes to saved rules require exact quotes from the latest user request. Define behavior checks before implementation.",
    schema: {...objectSchema({ title: { type: "string", maxLength: 120 }, requirements: { type: "array", maxItems: 64, items: objectSchema({
      id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }, text: { type: "string", minLength: 1, maxLength: 600 }, kind: { enum: ["behavior", "constraint", "decision"] }, instruction: { type: "string", maxLength: 8000 }, open: { type: ["string", "null"], minLength: 1, maxLength: 600 },
    }) }, edits: { type: "array", items: objectSchema({ requirementId: { type: "string" }, operation: { enum: ["replace", "remove"] }, instruction: { type: "string" } }) }, architecture: { type: "object", properties: { checks: { type: "array", maxItems: 6 } } },
      architectureUpdates:{type:"array",minItems:1,maxItems:64,items:{oneOf:[
        objectSchema({operation:{const:"set"},path:{type:"array",minItems:1,maxItems:12,items:{type:"string",minLength:1,maxLength:120}},value:{}}),
        objectSchema({operation:{const:"remove"},path:{type:"array",minItems:1,maxItems:12,items:{type:"string",minLength:1,maxLength:120}}}),
      ]}},
    },["title","requirements","edits"]),oneOf:[{required:["architecture"]},{required:["architectureUpdates"]}]},
    execute: async (context, input) => {
      const data = value(input), previous: LaunchIntent | undefined = context.revision.document.requirements.length ? {
        version: 1, id: context.projectId, revision: context.revision.requirementsHash.slice(7), requirements: context.revision.document.requirements,
        unresolved: context.revision.document.requirements.flatMap(rule => rule.open ? [rule.open] : []), changes: [],
      } : undefined;
      const proposed = parseIntentRequirements(data.requirements), edits = parseRuleEdits(data.edits, context.prompt);
      const interpreted = reviseLaunchIntent({ previous, proposed, edits, unresolved: proposed.flatMap(rule => rule.open ? [rule.open] : []),
        request: { id: context.runId, intent: "chat", messages: [
          ...(context.priorUserMessages ?? []).map(content => ({ role: "user" as const, content })),
          { role: "user", content: context.prompt },
        ] } });
      if (interpreted.problems.length) throw new ProjectError("project-requirements", "The plan omitted or changed a saved rule without support from the latest request.", 409);
      const priorArchitecture = context.revision.document.architecture;
      const updates=Object.prototype.hasOwnProperty.call(data,"architectureUpdates"),full=Object.prototype.hasOwnProperty.call(data,"architecture");
      if(updates===full)throw new ProjectError("project-plan-edit","Provide either a full architecture or updates to its saved fields.",409);
      const architecture = updates?applyPlanArchitectureUpdates(priorArchitecture,data.architectureUpdates):{ ...(priorArchitecture && typeof priorArchitecture === "object" && !Array.isArray(priorArchitecture) ? priorArchitecture : {}), ...value(data.architecture) };
      if(architecture.checks!==undefined)declaredProjectChecks(architecture,interpreted.intent.requirements.map(rule=>rule.id));
      assertCanonicalReferenceChanges(context.revision,interpreted.intent.requirements,architecture);
      if(architecture.useCanonicalProduction===true){
        if(!["contract","legacy-contract"].includes(String(architecture.kind))||!builderChains.some(chain=>chain.id===Number(architecture.chainId)))throw new ProjectError("contract-plan","Choose the contract chain before binding its launch profile.",409);
        architecture.production=json(await readLaunchBuildContext(Number(architecture.chainId) as BuilderChainId,context.signal));
      }
      if(architecture.contractChecks!==undefined&&(architecture.useCanonicalProduction===true||architecture.canonicalInterfaces!==undefined)){
        if(!["contract","legacy-contract"].includes(String(architecture.kind))||!builderChains.some(chain=>chain.id===Number(architecture.chainId)))throw new ProjectError("contract-interface","Choose the contract kind and chain before its canonical interface.",409);
        architecture.contractChecks=completeCanonicalContractInterfaces(architecture.contractChecks,Number(architecture.chainId) as BuilderChainId,architecture.canonicalInterfaces);
      }
      assertSavedCheckPlan(context.revision,interpreted.intent.requirements,architecture);
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
      const applicationRules=projectRequirementScopes(context.revision.document).application;
      if(applicationRules.length){
        const covered=new Set(declaredProjectChecks(architecture,context.revision.document.requirements.map(rule=>rule.id)).filter(check=>check.kind==="behavior").flatMap(check=>check.requirementIds));
        const missing=applicationRules.filter(id=>!covered.has(id));
        if(missing.length)throw new ProjectError("project-check-plan",`Declare behavior checks for these application requirements before implementing: ${missing.join(", ")}. Workflow instructions such as opening a checked preview belong in architecture.workflow, not application behavior. Correct an already saved requirement only with explicit user support.`,409);
      }
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

