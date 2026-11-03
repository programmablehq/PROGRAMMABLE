import "server-only";
import { posix } from "node:path";
import type { GeneralCheckBlueprint } from "./check-blueprint";
import type { ContractProject } from "./contract-project";
import {matchImplementationPattern} from "./implementation-patterns";

type Reference = { source: string; contract: string; functions: string[] };

/** Editable starting code, never a claim that the requested behavior exists.
 * Only exact pinned implementations with a compatible public surface qualify.
 * New auxiliary contracts remain explicit empty drafts until implemented. */
export function sourceFoundation(blueprint: GeneralCheckBlueprint, paths: readonly string[],
  dependencies: ContractProject["sources"], references: readonly Reference[]): {sources:ContractProject["sources"];completeReference:boolean} | null {
  const pattern=matchImplementationPattern(blueprint,paths,{sources:dependencies,references});
  if(pattern)return {sources:pattern,completeReference:true};
  const seeds: ContractProject["sources"] = {};
  let recognized = 0;
  for (const path of paths) {
    const targets = [...blueprint.scenarios.contracts,...(blueprint.scenarios.constructorChildren??[])].filter(contract => contract.source === path);
    if (targets.length !== 1) return null;
    const target = targets[0], functions = new Set(target.functions);
    const reference = references.filter(item => item.functions.length >= 10 && dependencies[item.source]
      && item.functions.every(fn => functions.has(fn))).sort((a, b) => b.functions.length - a.functions.length)[0];
    if (!reference) { seeds[path] = { content: `// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract ${target.contract} {}\n` }; continue; }
    recognized++;
    const content = dependencies[reference.source].content
      .replace(new RegExp(`\\b${reference.contract}\\b`, "g"), target.contract)
      .replace(/(\bfrom\s*|\bimport\s*)(["'])(\.[^"']+)\2/g, (_match, prefix, quote, relative) =>
        `${prefix}${quote}${posix.normalize(posix.join(posix.dirname(reference.source), relative))}${quote}`);
    seeds[path] = { content };
  }
  return recognized ? {sources:seeds,completeReference:false} : null;
}
