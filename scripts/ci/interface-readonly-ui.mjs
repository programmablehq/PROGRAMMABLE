import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { isInterfacePresentationOnlyChange } from "./classify-verify-paths.mjs";

const readGitChange = (file, { baseSha, headSha }) => [baseSha, headSha].map(sha =>
  execFileSync("git", ["show", `${sha}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));

/** Only the existing read-only entry routes qualify. Calls, event handlers,
 * external URLs and transaction values keep their ordinary behavior checks. */
function navigationShape(source) {
  const ts = createRequire(resolve("package.json"))("typescript");
  const tree = ts.createSourceFile("entry.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (tree.parseDiagnostics.length) throw Error("Invalid TSX");
  const links = new Set(["a"]);
  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === "next/link"
      && statement.importClause?.name) links.add(statement.importClause.name.text);
  }
  const edits = [];
  const safePath = value => /^\/(?:docs(?:[/?#]|$)|launch\/custom-ai(?:[/?#]|$)|developers\/api-keys(?:[/?#]|$))/u.test(value)
    && !/[\u0000-\u0020\\]/u.test(value);
  const safeVariable = value => ts.isIdentifier(value) && ["chainId", "initialViewChainId"].includes(value.text)
    || ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)
      && value.expression.text === "network" && value.name.text === "id";
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxClosingElement(node) || ts.isJsxSelfClosingElement(node))
      && links.has(node.tagName.getText(tree))) {
      if (node.tagName.getText(tree) !== "a") edits.push([node.tagName.getStart(tree), node.tagName.end, "a"]);
      for (const attribute of node.attributes?.properties ?? []) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(tree) !== "href" || !attribute.initializer) continue;
        const value = ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer;
        const allowed = value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) && safePath(value.text)
          || value && ts.isTemplateExpression(value) && safePath(value.head.text)
            && value.templateSpans.every(span => safeVariable(span.expression) && !/[\u0000-\u0020\\]/u.test(span.literal.text));
        if (allowed) edits.push([attribute.initializer.getStart(tree), attribute.initializer.end, '"/docs"']);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + value + source.slice(end);
  return source;
}

export function isReadOnlyInterfaceFile(file, { baseSha, headSha, readChange = readGitChange, validateFile } = {}) {
  if (!/^(?:app|components)\/(?!api\/).*\.(?:tsx|css)$/u.test(file)) return false;
  return isInterfacePresentationOnlyChange([file], {
    baseSha, headSha, ...(validateFile ? { validateFile } : {}),
    readChange(path, revisions) {
      const [before, after] = readChange(path, revisions);
      if (typeof before !== "string" || typeof after !== "string" || before === after) throw Error("Missing change");
      // The original predicate validates regular files and compares syntax,
      // ignoring only display copy. Preserve a textual difference after URL
      // normalization so a URL-only edit can use that same syntax comparison.
      return [navigationShape(before), navigationShape(after) + "\n"];
    },
  });
}
