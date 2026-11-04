"use client";
import type { ExecutionTrace } from "@/lib/custom-ai/execution-trace";
import { Disclosure } from "@/components/disclosure";
import styles from "./workspace.module.css";

const label = (value:string) => value.replace(/^(account|contract|recipient)\//, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/-/g, " ");
const change = (before:string, after:string) => {
  const delta=BigInt(after)-BigInt(before);
  return `${delta<0n?"−":"+"}${(delta<0n?-delta:delta).toString()} wei`;
};

export function ExecutionPreview({trace}:{trace?:ExecutionTrace}) {
  if(!trace?.steps.length)return null;
  return <Disclosure className={`${styles.ruleReview} ${styles.coinRules}`}>
    <summary>Simulation<span>{trace.executedSteps} of {trace.plannedSteps} steps</span></summary>
    <section className={styles.executionPreview} aria-label="Observed contract simulation">
      <p className={styles.note}>Local simulation with test balances. Native changes use wei; contract results use raw units. Gas fees excluded.</p>
      <ol>
        {trace.steps.map(step=><li key={step.id}>
          <div className={styles.executionStepTitle}><strong>{label(step.id)}</strong><span>{step.status==="revert"?"Reverted":step.read?"Read":"Executed"}</span></div>
          <p className={styles.note}>{label(step.contract)} · {step.signature} · {label(step.from)}{step.afterSeconds>0?` · after ${step.afterSeconds}s`:""}</p>
          {step.outputs.length>0&&<dl>{step.outputs.map((output,index)=><div key={index}><dt>{/^value\d+$/.test(output.name)?"Result":label(output.name)}</dt><dd>{output.value}{output.truncated?"…":""}</dd></div>)}</dl>}
          {step.nativeChanges.length>0&&<dl>{step.nativeChanges.map(balance=><div key={balance.account}><dt>{label(balance.account)}</dt><dd>{change(balance.before,balance.after)}</dd></div>)}</dl>}
          {step.events.length>0&&<details><summary>Events ({step.events.length})</summary><ul>{step.events.map((event,index)=><li key={index}>
            <strong>{event.name}</strong><dl>{event.arguments.map((arg,position)=><div key={position}><dt>{label(arg.name)}</dt><dd>{arg.value}{arg.truncated?"…":""}</dd></div>)}</dl>
          </li>)}</ul></details>}
          {!step.detailsComplete&&<p className={styles.note}>Some result details are too large or cannot be decoded.</p>}
        </li>)}
      </ol>
      {trace.steps.length<trace.executedSteps&&<p className={styles.note}>Showing the first {trace.steps.length} executed steps. Remaining details were not recorded.</p>}
      {trace.executedSteps<trace.plannedSteps&&<p className={styles.note}>Execution stopped before the remaining steps.</p>}
    </section>
  </Disclosure>;
}
