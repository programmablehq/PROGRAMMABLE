import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { ContractProject } from "./contract-project";

/** Compact only immutable dependency context. The compiler and saved project
 * continue to receive the complete original sources, including comments. */
export function compactDependencyCode(source: string): string {
  let output = "", space = false, index = 0;
  const appendSpace = () => { if (space && output) output += " "; space = false; };
  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) { space = true; index++; continue; }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index++;
      space = true; continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new TypeError("The dependency contains an unfinished comment.");
      index = end + 2; space = true; continue;
    }
    appendSpace();
    if (character === '"' || character === "'") {
      const quote = character;
      output += source[index++];
      let closed = false;
      while (index < source.length) {
        const next = source[index++]; output += next;
        if (next === "\\") {
          if (index === source.length) break;
          output += source[index++];
        } else if (next === quote) { closed = true; break; }
      }
      if (!closed) throw new TypeError("The dependency contains an unfinished string.");
    } else output += source[index++];
  }
  return output;
}

/** A reference to library declarations, never a replacement compiler input.
 * Keep names, types, inheritance, storage, constants and imports verbatim. Only
 * function/modifier bodies are elided; quoted braces cannot end a body. */
export function libraryDeclarationReference(source: string): string {
  const code = compactDependencyCode(source);
  const tokens = [...code.matchAll(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_$][A-Za-z0-9_$]*|[^\s]/gu)];
  let result = "", from = 0;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index][0] !== "function" && tokens[index][0] !== "modifier") continue;
    let parentheses = 0;
    for (let next = index + 1; next < tokens.length; next++) {
      const value = tokens[next][0];
      if (value === "(") parentheses++;
      else if (value === ")") parentheses--;
      else if (!parentheses && value === ";") { index = next; break; }
      else if (!parentheses && value === "{") {
        let depth = 1, end = next;
        while (depth && ++end < tokens.length) {
          if (tokens[end][0] === "{") depth++;
          else if (tokens[end][0] === "}") depth--;
        }
        if (depth) throw new TypeError("The library contains an unfinished function body.");
        result += code.slice(from, tokens[next].index).trimEnd() + ";";
        from = tokens[end].index! + 1;
        index = end;
        break;
      }
    }
  }
  return result + code.slice(from);
}

export function dependencySourceContext(sources: ContractProject["sources"], options: { libraryDeclarations?: boolean } = {}) {
  const complete = Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, { content: source.content }]));
  const compact = Object.values(complete).reduce((length, source) => length + source.content.length, 0) > 64_000;
  const declarations = compact && options.libraryDeclarations;
  return {
    complete,
    modelSources: compact ? Object.fromEntries(Object.entries(complete).map(([path, source]) => [path, {
      content: declarations && path.startsWith("lib/") ? libraryDeclarationReference(source.content) : compactDependencyCode(source.content),
    }])) : complete,
    view: {
      format: declarations ? "library-declarations-and-policy-source-v1" as const : compact ? "code-without-comments-v1" as const : "complete-source-v1" as const,
      originalSourceHash: canonicalBrowserSha256V2("programmable.custom-ai-dependency-sources.v1", complete),
    },
  };
}
