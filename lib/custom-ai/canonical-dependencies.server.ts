import "server-only";
import sourcePackage from "@/packages/launch/contracts/launch-protection-v1/standard-json.json";
import type { ContractProject } from "./contract-project";

// These exact library sources are shared by the three published protection
// packages. No runtime downloads, package installs or filesystem imports occur.
const libraries = Object.fromEntries(Object.entries(sourcePackage.sources).filter(([path]) => path.startsWith("lib/")));

export function canonicalGeneralLibraries(previous?: ContractProject): ContractProject["sources"] {
  return Object.fromEntries(Object.entries(libraries)
    // A previously edited library stays part of the user's editable source.
    // Adding the canonical context must never overwrite it or label it fixed.
    .filter(([path, source]) => !previous?.sources[path] || previous.sources[path].content === source.content)
    .map(([path, source]) => [path, { content: source.content }]));
}
