"use client";
import {useState} from "react";
import {ArrowUpRight,Code2,Layers3,Workflow} from "lucide-react";
import {builderChains,type BuilderChainId} from "@/lib/custom-ai/execution-routing";
import styles from "./workspace.module.css";

const starters = [
  {id:"hook", title:"Custom hook", description:"Fees, trading rules and onchain mechanics", icon:Workflow, prompt:(network:string) => `Build a custom hook on ${network}. `},
  {id:"app", title:"Web app", description:"An interface, backend and saved data", icon:Code2, prompt:() => "Build a complete web app with a backend and persistent data. "},
  {id:"connected", title:"Contract + app", description:"A game, an API or an app connected to a contract", icon:Layers3, prompt:(network:string) => `Build a connected project on ${network} with a custom contract and a web app. `},
];
const starterPrompts = new Set(builderChains.flatMap(chain => starters.map(starter => starter.prompt(chain.name))));

export function ProjectStart({disabled,draft,onChoose}:{disabled:boolean;draft:string;onChoose:(prompt:string)=>void}){
  const [chainId,setChainId]=useState<BuilderChainId>(8453);
  const chain=builderChains.find(item=>item.id===chainId)!;
  const canChoose = !disabled && (!draft.trim() || starterPrompts.has(draft));
  return <div className={styles.empty}>
    <h2>What should we build?</h2>
    <p>One hook, a complete app, or both. Describe what it should do.</p>
    <label className={styles.starterNetwork}><span>Network for contract starters</span><select aria-label="Network for contract starters" value={chainId} disabled={!canChoose} onChange={event=>setChainId(Number(event.target.value) as BuilderChainId)}>{builderChains.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className={styles.examples}>{starters.map(item=><button type="button" key={item.id} disabled={!canChoose} onClick={()=>onChoose(item.prompt(chain.name))}>
      <item.icon size={20} aria-hidden="true"/><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowUpRight size={16} aria-hidden="true"/>
    </button>)}</div>
  </div>;
}
