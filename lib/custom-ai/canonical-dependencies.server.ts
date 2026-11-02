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
export type CanonicalInterfaceContext={id:`sha256:${string}`;contracts:(typeof interfaces.families)["launch-protection-v1"]};
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
  const value={id:canonicalBrowserSha256V2("programmable.canonical-interface-context.v1",{chainId,contracts}),contracts};
  interfaceCache.set(chainId,value);return structuredClone(value);
}

function sourceCatalog(sources: ContractProject["sources"], previous?: ContractProject) {
  return Object.fromEntries(Object.entries(sources)
    // A previously edited library stays part of the user's editable source.
    // Adding the canonical context must never overwrite it or label it fixed.
    .filter(([path, source]) => !previous?.sources[path] || previous.sources[path].content === source.content)
    .map(([path, source]) => [path, { content: source.content }]));
}
