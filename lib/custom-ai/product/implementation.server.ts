import "server-only";
import { parseAbi, toFunctionSignature } from "viem";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { bindGeneralCheckBlueprint, type GeneralCheckBlueprint } from "../check-blueprint";
import { generalCheckCaseCount } from "../behavior-checks";
import type { ContractProject } from "../contract-project";
import type { CompiledProject } from "../contract-project.server";
import type { GeneralScenarioReport } from "../behavior-checks.server";
import { checkedProductBlueprint, type ProductBlueprint } from "./blueprint";
import { checkedProductBindings } from "./bindings";
import type { ProductImplementation } from "./implementation";

/** Resolve planned components against the actual compiler ABI, not generated claims. */
export function createProductImplementation(product: ProductBlueprint, blueprint: GeneralCheckBlueprint, project: ContractProject, compilation: CompiledProject, scenarios?: GeneralScenarioReport): ProductImplementation | undefined {
  if (!blueprint.productBindings || !compilation.compiled) return;
  checkedProductBlueprint(product,project.intent,project.chainId);
  const plan=bindGeneralCheckBlueprint(blueprint,project);
  if (product.id !== project.productBlueprintId || product.id !== blueprint.productBlueprintId || product.intentRevision !== project.intent.revision
    || product.chainId !== project.chainId || compilation.projectHash !== project.hash) throw TypeError("Product implementation context changed.");
  const { artifactHash, ...artifacts } = compilation;
  if (artifactHash !== canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", artifacts)) throw TypeError("Product compiler artifacts changed.");
  const bindings = checkedProductBindings(blueprint.productBindings, blueprint.scenarios, blueprint.entrypoints, product);
  const fixtures = new Map([...blueprint.scenarios.contracts, ...(blueprint.scenarios.constructorChildren ?? [])].map(fixture => [fixture.id, fixture]));
  for(const binding of bindings.components){
    const fixture=fixtures.get(binding.contract)!;
    if(!compilation.contracts.some(artifact=>artifact.source===fixture.source&&artifact.contract===fixture.contract))return;
  }
  for(const binding of bindings.actions){
    const fixture=fixtures.get(binding.contract)!;
    const declared=parseAbi(fixture.functions).find(item=>item.type==="function"&&toFunctionSignature(item)===binding.signature);
    const artifact=compilation.contracts.find(artifact=>artifact.source===fixture.source&&artifact.contract===fixture.contract)!;
    const actual=artifact.abi.find(item=>item.type==="function"&&toFunctionSignature(item)===binding.signature);
    if(!declared||declared.type!=="function"||!actual||actual.type!=="function"||actual.stateMutability!==declared.stateMutability)return;
  }
  const components = bindings.components.map(binding => {
    const fixture = fixtures.get(binding.contract)!;
    return { id: binding.component, fixture: binding.contract, source: fixture.source, contract: fixture.contract };
  });
  const actions = bindings.actions.map(binding => {
    const fixture = fixtures.get(binding.contract)!;
    const artifact = compilation.contracts.find(artifact => artifact.source === fixture.source && artifact.contract === fixture.contract)!;
    const fn = artifact.abi.find(item => item.type === "function" && toFunctionSignature(item) === binding.signature);
    if (!fn || fn.type !== "function") throw TypeError("Product action is absent from the compiled ABI.");
    return { id: binding.action, target: product.interfaceActions.find(action => action.id === binding.action)!.target,
      fixture: binding.contract, signature: binding.signature, mutability: fn.stateMutability };
  });
  if(scenarios){
    const {hash,...report}=scenarios;
    if(scenarios.projectHash!==project.hash||scenarios.artifactHash!==artifactHash||scenarios.planHash!==plan.id||scenarios.version!==plan.version
      ||scenarios.scope!==`isolated-declared-scenarios-v${plan.version}`||scenarios.launchReady!==false
      ||JSON.stringify(scenarios.requirementIds)!==JSON.stringify(project.intent.requirements.map(rule=>rule.id).sort())
      ||hash!==canonicalBrowserSha256V2(`programmable.general-scenario-report.v${plan.version}`,report))throw TypeError("Product scenario evidence changed.");
  }
  const passed = scenarios?.passed === true && scenarios.failures.length===0 && scenarios.cases===generalCheckCaseCount(plan);
  const body = { version: 1 as const, productBlueprintId: product.id, projectHash: project.hash, artifactHash,
    checkBlueprintId: blueprint.id, intentRevision: product.intentRevision,
    evidence: passed ? "declared-scenarios-passed" as const : "compiled-interface" as const, deployed: false as const, components, actions };
  return { ...body, id: canonicalBrowserSha256V2("programmable.product-implementation.v1", body) };
}

