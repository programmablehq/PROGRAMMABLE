import { compactDependencyCode } from "./dependency-source-context";
import { VIAIR_200_REMAPPINGS, type ProjectCompiler } from "./compiler-profile";
import type { ContractProject } from "./contract-project";

function imports(source: string): string[] {
  const tokens = compactDependencyCode(source).match(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_$][A-Za-z0-9_$]*|[^\s]/gu) ?? [];
  const paths: string[] = [];
  let importing = false;
  for (const token of tokens) {
    if (token === "import") importing = true;
    else if (token === ";") importing = false;
    else if (importing && (token[0] === '"' || token[0] === "'")) {
      const path = token.slice(1, -1);
      if (path.includes("\\")) throw new TypeError("Use an exact inline library import path.");
      paths.push(path); importing = false;
    }
  }
  return paths;
}

function resolve(sourcePath: string, imported: string, compiler: ProjectCompiler): string | null {
  let path = imported;
  if (compiler.viaIR) {
    const alias = [...VIAIR_200_REMAPPINGS].sort((a, b) => b.indexOf("=") - a.indexOf("=")).find(value => path.startsWith(value.split("=")[0]));
    if (alias) { const [prefix, target] = alias.split("="); path = target + path.slice(prefix.length); }
  }
  if (/^\.{1,2}\//u.test(path)) path = sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) + path;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}

/** Resolve only declared imports from an in-memory, pinned source map. This
 * never reads host paths, uses an import callback or downloads a dependency. */
export function resolveInlineLibraries(sources: ContractProject["sources"], libraries: ContractProject["sources"], compiler: ProjectCompiler): ContractProject["sources"] {
  const result = structuredClone(sources), pending = Object.keys(result), visited = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    for (const imported of imports(result[path].content)) {
      const resolved = resolve(path, imported, compiler);
      if (!resolved || Object.hasOwn(result, resolved) || !Object.hasOwn(libraries, resolved)) continue;
      result[resolved] = { content: libraries[resolved].content };
      pending.push(resolved);
    }
  }
  return result;
}
