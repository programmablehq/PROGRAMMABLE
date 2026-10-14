import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const root = process.cwd();
export const interfaceVerificationPaths = new Set([
  "scripts/ci/interface-plan.mjs", "scripts/ci/interface-plan.test.mjs",
  "scripts/ci/verify-interface.mjs", "scripts/ci/classify-verify-paths.test.mjs",
  "scripts/ci/README.md",
]);
const globalInput = /^(?:package(?:-lock)?\.json|[^/]*config\.[^/]+|tsconfig[^/]*\.json|\.github\/|scripts\/ci\/|lib\/vendor\/)/u;
const sourceInput = /^(?:app|components|lib|tests|public|assets)\//u;
const browserGroups = [
  [/(?:wallet|permit|transaction|signer|authorization|auth|allowance|balance|chain|rpc|provider)/iu,
    ["wallet-request-lock", "wallet-session", "module-signing", "module-mode-operation", "module-native-author-wallet"]],
  [/(?:launch|module-foundation-(?:catalog|selection|engine))/iu,
    ["module-signing", "module-mode-operation", "module-launch-selection", "module-engine-host", "module-engine-fee-controls", "module-engine-discovery"]],
  [/(?:trade|swap|market-view|module-foundation-market)/iu, ["trade-panel", "foundation-swap-recovery"]],
  [/(?:module-engine|module-host|module-sdk|classic-modules)/iu, ["module-engine-host", "module-engine-fee-controls", "module-engine-discovery"]],
  [/(?:profile|author)/iu, ["module-author-profile", "module-native-author-wallet"]],
  [/(?:site-header|site-navigation|app-shell|app\/layout)/iu, ["site-header"]],
  [/explore/iu, ["explore-visibility"]],
  [/(?:disclosure|dialog)/iu, ["disclosure-motion"]],
];

export function changedPaths(env = process.env) {
  const base = env.PROGRAMMABLE_CI_BASE_SHA, head = env.PROGRAMMABLE_CI_HEAD_SHA;
  if (!/^[a-f0-9]{40}$/u.test(base ?? "") || !/^[a-f0-9]{40}$/u.test(head ?? "")) return null;
  try {
    return execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", base, head],
      { encoding: "utf8" }).split("\0").filter(Boolean);
  } catch { return null; }
}

export function interfacePlan(paths) {
  const full = !paths || paths.some(path => !interfaceVerificationPaths.has(path) && (globalInput.test(path)
    || (!sourceInput.test(path) && !/^(?:docs\/|scripts\/|packages\/|contracts\/|config\/|ops\/|supabase\/|indexer\/|AGENTS\.md|README\.md)/u.test(path))));
  const any = (pattern) => full || paths.some(path => pattern.test(path));
  const browser = [...new Set(browserGroups.filter(([pattern]) => any(pattern)).flatMap(([, specs]) => specs))];
  for (const path of paths ?? []) {
    const match = path.match(/^tests\/browser\/([^/]+)\.spec\.ts$/u);
    if (match && match[1] !== "late-migration" && !browser.includes(match[1])) browser.push(match[1]);
  }
  return {
    full,
    verificationTools: Boolean(paths?.some(path => interfaceVerificationPaths.has(path))),
    browser,
    wallet: browser.length > 0,
    migration: any(/(?:migration|wallet-provider|wallet-operation|chain-switch|app\/layout|app-shell)/u),
    moduleTools: any(/^(?:packages\/classic-modules\/|scripts\/(?:build-module-cli|module-cli|test\/module-cli)|contracts\/.*(?:module|Module))/u),
    activation: any(/^(?:contracts\/|config\/.*(?:custom|launch|registry)|lib\/custom-launch\/.*(?:discovery|manifest|release)|scripts\/.*(?:activation|release|clean-room)|docs\/operations\/releases\/)/u),
    readModel: any(/^(?:lib\/(?:server\/|data-pipeline\/|market-data\/)|app\/api\/(?:explore|ops)\/|scripts\/(?:data-pipeline\/|perf\/))/u),
    scriptTests: any(/^(?:scripts\/|config\/|contracts\/|docs\/operations\/)/u),
  };
}

// Vitest tracks import edges, but source-contract tests also read files from
// disk. Include readers of changed files and their callers in the related set.
// Dynamic readers without a resolvable path stay in the set conservatively.
export function relatedInputs(paths, files, read = file => readFileSync(file, "utf8")) {
  const known = new Set([...files, ...paths]);
  const inputs = new Set(paths);
  const readers = [];
  for (const file of files.filter(path => /\.[cm]?[jt]sx?$/u.test(path))) {
    const source = read(file);
    const readsFiles = /\b(?:readFileSync|readFile|readdirSync|readdir|globSync)\b/u.test(source);
    const references = new Set();
    for (const match of source.matchAll(/["'`]([^"'`\n]+)["'`]/gu)) {
      const value = match[1].replace(/^@\//u, "");
      for (const candidate of [value, relative(root, resolve(dirname(file), value))]) {
        for (const suffix of ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"]) {
          if (known.has(candidate + suffix)) references.add(candidate + suffix);
        }
        if (candidate.endsWith("/")) {
          for (const path of files) if (path.startsWith(candidate)) references.add(path);
        }
      }
    }
    readers.push({ file, references });
    // A known source-file reader follows the same dependency graph as an
    // import. Only genuinely unresolved readers require conservative coverage.
    const knownFileRead = [...references].some(path =>
      !/(?:^|\/)tests\//u.test(path) && !/\.test\.[cm]?[jt]sx?$/u.test(path));
    if (readsFiles && !knownFileRead && /(?:tests\/|\.test\.)/u.test(file)) inputs.add(file);
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const { file, references } of readers) {
      if (!inputs.has(file) && [...references].some(path => inputs.has(path))) {
        inputs.add(file); expanded = true;
      }
    }
  }
  return [...inputs].filter(file => existsSync(file));
}
