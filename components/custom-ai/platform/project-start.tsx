"use client";
import {useState} from "react";
import {ArrowUpRight,Code2,Layers3,Workflow} from "lucide-react";
import {builderChains,type BuilderChainId} from "@/lib/custom-ai/execution-routing";
import styles from "./workspace.module.css";

export function ProjectStart({disabled,onChoose}:{disabled:boolean;onChoose:(prompt:string)=>void}){
  const [chainId,setChainId]=useState<BuilderChainId>(8453);
  const chain=builderChains.find(item=>item.id===chainId)!;
  const starters=[
    {id:"hook",title:"Custom hook",description:"Fees, trading rules and onchain mechanics",icon:Workflow,prompt:`Build a custom hook on ${chain.name}. `},
    {id:"app",title:"Web app",description:"An interface, backend and saved data",icon:Code2,prompt:"Build a complete web app with a backend and persistent data. "},
    {id:"connected",title:"Contract + app",description:"A game, an API or an app connected to a contract",icon:Layers3,prompt:`Build a connected project on ${chain.name} with a custom contract and a web app. `},
  ];
  return <div className={styles.empty}>
    <span className={styles.eyebrow}>Programmable workspace</span>
    <h2>What should we build?</h2>
    <p>Describe what it should do. Start with one hook or build the whole project around it.</p>
    <div className={styles.examples}>{starters.map(item=><button type="button" key={item.id} disabled={disabled} onClick={()=>onChoose(item.prompt)}>
      <item.icon size={20} aria-hidden="true"/><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowUpRight size={16} aria-hidden="true"/>
    </button>)}</div>
    <label className={styles.starterNetwork}><span>Network for contract starters</span><select aria-label="Network for contract starters" value={chainId} disabled={disabled} onChange={event=>setChainId(Number(event.target.value) as BuilderChainId)}>{builderChains.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <p className={styles.startHint}>You can also just type. Every project keeps its files, decisions and progress.</p>
  </div>;
}
