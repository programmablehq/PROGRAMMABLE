"use client";

import { Disclosure } from "@/components/disclosure";
import type { ProductBlueprint, ProductIssue } from "@/lib/custom-ai/product/blueprint";
import { reviewProductEconomics } from "@/lib/custom-ai/product/economics";
import type {ProductImplementation} from "@/lib/custom-ai/product/implementation";
import styles from "./workspace.module.css";

function issueText(issue: ProductIssue): string {
  if (issue.code === "incomplete-allocation") return `${(issue.basisPoints ?? 0) / 100}% of these funds still needs a destination.`;
  if (issue.code === "excess-allocation") return `The allocation exceeds the available funds by ${(issue.basisPoints ?? 0) / 100}%.`;
  if (issue.code === "unresolved-share") return "A share of the funds is still undecided.";
  if (issue.code === "failure-policy") return "An automated action still needs a fallback when its input or service is unavailable.";
  return "Some saved rules still need to be assigned to the implementation.";
}

export function ProductPlan({ blueprint, implementation }: { blueprint: ProductBlueprint; implementation?:ProductImplementation }) {
  const names = new Map(blueprint.components.map(component => [component.id, component.name]));
  const assets = new Map(blueprint.assets.map(asset => [asset.id, asset.name]));
  const economics = reviewProductEconomics(blueprint);
  const linked=implementation?.productBlueprintId===blueprint.id&&implementation.intentRevision===blueprint.intentRevision?implementation:undefined;
  return <Disclosure className={`${styles.ruleReview} ${styles.coinRules}`}>
    <summary>Product plan<span>{blueprint.components.length}</span></summary>
    <p className={styles.note}>The parts of your design. Implementation and launch are checked separately.</p>
    <ul>
      {blueprint.components.map(component => <li key={component.id}><strong>{component.name}</strong><br />{component.purpose}</li>)}
    </ul>
    {linked&&linked.actions.length>0&&<section aria-label="Linked contract actions">
      <h3>Contract actions</h3>
      <p className={styles.note}>{linked.evidence==="declared-scenarios-passed"?"Linked to the source and checked locally.":"Linked to the compiled source."}</p>
      <ul>{linked.actions.map(action=><li key={action.id}>{names.get(action.target)} · <code>{action.signature}</code></li>)}</ul>
    </section>}
    {blueprint.flows.length > 0 && <>
      <h3>Where funds go</h3>
      <ul>{blueprint.flows.map(flow => <li key={flow.id}>
        {flow.allocationGroup === null ? "Transfer" : flow.shareBps === null ? "Undecided share" : `${flow.shareBps / 100}%`} → {names.get(flow.target) ?? flow.target}<br />
        {flow.purpose} ({assets.get(flow.asset)})
      </li>)}</ul>
    </>}
    {blueprint.services.length > 0 && <p className={styles.note}>This design also needs {blueprint.services.length === 1 ? "an integrated service" : `${blueprint.services.length} integrated services`}. Their presence in the plan does not mean they are running.</p>}
    {economics.fundingToDefine.length > 0 && <p className={styles.note}>Funding still needs to be defined for {economics.fundingToDefine.map(item => `${names.get(item.component)} (${assets.get(item.asset)})`).join(", ")}.</p>}
    {blueprint.issues.length > 0 && <div aria-label="Open product decisions">
      <h3>Still to resolve</h3>
      <ul>{blueprint.issues.map((issue, index) => <li key={index}>{issueText(issue)}</li>)}</ul>
    </div>}
  </Disclosure>;
}
