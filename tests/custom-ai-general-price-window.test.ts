import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import fixture from "./fixtures/custom-ai-fee-flow-window.json";
import discovery from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import {canonicalGeneralSourceCatalog,canonicalImplementationLibraries,canonicalInterfaceContext} from "../lib/custom-ai/canonical-dependencies.server";
import {generalCheckBlueprintInput,createGeneralCheckBlueprint,bindGeneralCheckBlueprint,type GeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import {createContractProject} from "../lib/custom-ai/contract-project";
import {compileContractProject} from "../lib/custom-ai/contract-project.server";
import {checkGeneralScenarios} from "../lib/custom-ai/behavior-checks.server";
import {sourceFoundation} from "../lib/custom-ai/source-foundation.server";
import {resolveInlineLibraries} from "../lib/custom-ai/inline-libraries";
import {cachedLaunchIntent} from "../lib/custom-ai/launch-intent";
import {projectLaunchProductionContext} from "../lib/custom-ai/launch-production.server";

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("fee-flow observation window",()=>{
 it("allows real LP and buyback after a stable hour while retaining immediate repeat and holder-claim guards",async()=>{
  const intent=cachedLaunchIntent(fixture.intent)!,production=projectLaunchProductionContext(discovery.chains["8453"],8453,protection);
  const declaration=generalCheckBlueprintInput(fixture.blueprint as unknown as GeneralCheckBlueprint);
  const blueprint=createGeneralCheckBlueprint({...declaration,steps:fixture.steps},intent,8453,"cancun",production);
  const dependencies={...canonicalGeneralSourceCatalog(undefined,8453),...canonicalImplementationLibraries()};
  const catalog=canonicalInterfaceContext(8453),paths=[...new Set(blueprint.entrypoints.map(item=>item.source))].filter(path=>!dependencies[path]);
  const foundation=sourceFoundation(blueprint,paths,dependencies,catalog.contracts);
  expect(foundation?.completeReference).toBe(true);
  const pinned=Object.fromEntries(blueprint.entrypoints.flatMap(item=>dependencies[item.source]?[[item.source,dependencies[item.source]]]:[]));
  const project=createContractProject({compiler:blueprint.compiler,sources:resolveInlineLibraries({...pinned,...foundation!.sources},dependencies,blueprint.compiler),entrypoints:blueprint.entrypoints},intent,8453,production,blueprint.deployment);
  const compilation=await compileContractProject(project);expect(compilation.compiled,JSON.stringify(compilation.diagnostics)).toBe(true);
  const checked=await checkGeneralScenarios(project,compilation,bindGeneralCheckBlueprint(blueprint,project));
  expect(checked.passed,JSON.stringify(checked.failures)).toBe(true);
 },90000);
});
