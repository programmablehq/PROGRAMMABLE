import "server-only";
import sourcePackage from "@/packages/launch/contracts/launch-protection-v1/standard-json.json";
import baseSourcePackage from "@/packages/launch/contracts/base-launch-protection-v1/standard-json.json";
import hyperSourcePackage from "@/packages/launch/contracts/hyperevm-launch-protection-v1/standard-json.json";
import type { ContractProject } from "./contract-project";
import { builderChain, type BuilderChainId } from "./execution-routing";
import interfaces from "./canonical-interfaces.json";
import {createHash} from "node:crypto";
import {canonicalBrowserSha256V2} from "@/lib/custom-launch/browser-authority-v2";

// These exact library sources are shared by the three published protection
// packages. No runtime downloads, package installs or filesystem imports occur.
const libraries = Object.fromEntries(Object.entries(sourcePackage.sources).filter(([path]) => path.startsWith("lib/")));

export function canonicalGeneralLibraries(previous?: ContractProject): ContractProject["sources"] {
  return sourceCatalog(libraries, previous);
}

/** The chain-specific original protection contracts are available as imports,
 * alongside the shared libraries. Their availability does not insert them into
 * an unconnected project or replace user code. Only used import closures are
 * compiled by the builder. */
export function canonicalGeneralSourceCatalog(previous: ContractProject | undefined, chainId: BuilderChainId): ContractProject["sources"] {
  builderChain(chainId);
  const kit = chainId === 8453 ? baseSourcePackage : chainId === 999 ? hyperSourcePackage : sourcePackage;
  return sourceCatalog(kit.sources, previous);
}

const interfaceCache=new Map<BuilderChainId,CanonicalInterfaceContext>();
export type CanonicalInterfaceContext={id:`sha256:${string}`;contracts:(typeof interfaces.families)["launch-protection-v1"];
  construction:{contract:string;source:string;constructorSource:string;structSources:string[];callbackDeclarations:string[];initializationSources:string[]}[]};
/** Exact local ABI reference before source-blind planning. Verify the catalog
 * against its immutable inline source, not a search result or a guessed ABI. */
export function canonicalInterfaceContext(chainId:BuilderChainId):CanonicalInterfaceContext {
  builderChain(chainId);
  const saved=interfaceCache.get(chainId);if(saved)return structuredClone(saved);
  const family=chainId===8453?"base-launch-protection-v1":chainId===999?"hyperevm-launch-protection-v1":"launch-protection-v1";
  const sources=canonicalGeneralSourceCatalog(undefined,chainId),contracts=interfaces.families[family];
  for(const contract of contracts){
    const source=sources[contract.source];
    if(!source||createHash("sha256").update(source.content).digest("hex")!==contract.sourceSha256)throw new Error("Canonical interface source changed; regenerate its catalog.");
  }
  const construction=contracts.map(contract=>constructionFacts(sources[contract.source].content,contract.contract,contract.source));
  const value={id:canonicalBrowserSha256V2("programmable.canonical-interface-context.v1",{chainId,contracts,construction}),contracts,construction};
  interfaceCache.set(chainId,value);return structuredClone(value);
}

/** Extract only immutable dependency declarations. No generated implementation
 * enters independent planning. Braces in comments and string literals are ignored. */
function declaration(source:string,start:number){
  let depth=0,opened=-1,quote="",line=false,block=false;
  for(let i=start;i<source.length;i++){
    const c=source[i],next=source[i+1];
    if(line){if(c==="\n")line=false;continue;}
    if(block){if(c==="*"&&next==="/"){block=false;i++;}continue;}
    if(quote){if(c==="\\"){i++;continue;}if(c===quote)quote="";continue;}
    if(c==="/"&&next==="/"){line=true;i++;continue;}
    if(c==="/"&&next==="*"){block=true;i++;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==="{"){if(opened<0)opened=i;depth++;}
    if(c==="}"&&opened>=0&&--depth===0)return {header:source.slice(start,opened).trim(),body:source.slice(opened+1,i),full:source.slice(start,i+1).trim()};
  }
  throw new Error("Pinned dependency declaration is incomplete.");
}
function constructionFacts(source:string,contract:string,path:string){
  const match=new RegExp(`^\\s*(?:abstract\\s+)?contract\\s+${contract}\\b`,"m").exec(source);
  if(!match)throw new Error("Pinned dependency contract is missing.");
  const body=declaration(source,match.index).body;
  const constructor=/^\s*constructor\s*\(/m.exec(body);
  const constructorSource=constructor?declaration(body,constructor.index).full:"";
  if(constructorSource.length>24000)throw new Error("Pinned constructor exceeds the knowledge bound.");
  const callbacks=[...body.matchAll(/^\s*function\s+(?:getHookPermissions|_beforeInitialize|_beforeSwap|_afterSwap)\s*\(/gm)]
    .map(match=>declaration(body,match.index!).header);
  const initializationSources=[...body.matchAll(/^\s*function\s+(?:initialize|initializeLaunch|getHookPermissions)\s*\(/gm)]
    .map(match=>declaration(body,match.index!).full);
  const structSources=[...body.matchAll(/^\s*struct\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/gm)]
    .map(match=>declaration(body,match.index!).full);
  if(initializationSources.reduce((size,text)=>size+text.length,0)>24000)throw new Error("Pinned initialization exceeds the knowledge bound.");
  if(structSources.reduce((size,text)=>size+text.length,0)>12000)throw new Error("Pinned structs exceed the knowledge bound.");
  return {contract,source:path,constructorSource,structSources,callbackDeclarations:callbacks,initializationSources};
}

function sourceCatalog(sources: ContractProject["sources"], previous?: ContractProject) {
  return Object.fromEntries(Object.entries(sources)
    // A previously edited library stays part of the user's editable source.
    // Adding the canonical context must never overwrite it or label it fixed.
    .filter(([path, source]) => !previous?.sources[path] || previous.sources[path].content === source.content)
    .map(([path, source]) => [path, { content: source.content }]));
}
