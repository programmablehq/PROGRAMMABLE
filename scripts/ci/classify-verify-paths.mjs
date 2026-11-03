import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Keep this selector self-contained: CI runs a copy from the trusted base
// commit in a temporary directory, before evaluating changed source files.
export const GENERAL_CONSTRUCTOR_WORKERS = Object.freeze([
  "scripts/custom-ai/general-runtime-worker.mjs",
  "scripts/custom-ai/general-runtime-v2-worker.mjs",
  "scripts/custom-ai/dependency-call-worker.mjs",
]);
export function isGeneralConstructorWorker(path) {
  return GENERAL_CONSTRUCTOR_WORKERS.includes(path);
}
export const GENERAL_BEHAVIOR_WORKERS = Object.freeze([
  "scripts/custom-ai/general-behavior-worker.mjs",
  "scripts/custom-ai/general-behavior-v2-worker.mjs",
  "scripts/custom-ai/general-v4-world.mjs",
  "scripts/custom-ai/general-protected-v4-world.mjs",
  "scripts/custom-ai/declared-events.mjs",
]);

/** Only a new trace entry for this bounded worker helper may be ignored by the
 * global configuration lane. Every other byte and every mixed path still counts. */
export function isCustomAITracingOnlyChange(paths, { baseSha, headSha, readChange = readGitChange } = {}) {
  if (!Array.isArray(paths) || !paths.includes("next.config.ts") || new Set(paths).size !== paths.length
    || !/^[a-f0-9]{40}$/u.test(baseSha ?? "") || !/^[a-f0-9]{40}$/u.test(headSha ?? "") || baseSha === headSha) return false;
  try {
    const [before, after] = readChange("next.config.ts", { baseSha, headSha });
    const helper = "scripts/custom-ai/declared-events.mjs", line = `  "./${helper}",\n`;
    const marker = "const customAIWorkerFiles = [\n", start = after.indexOf(marker), end = after.indexOf("\n];", start);
    const offset = after.indexOf(line);
    return paths.includes(helper) && start >= 0 && end > start && offset > start && offset < end
      && !before.includes(line) && offset === after.lastIndexOf(line) && after.replace(line, "") === before;
  } catch { return false; }
}

const EMPTY_SCOPE = Object.freeze({
  contracts: false,
  custom_v2: false,
  database: false,
  dependencies: false,
  indexer: false,
  interface: false,
  read_model: false,
  robinhood_phase_b_evidence: false,
  robinhood_phase_b_evidence_exact: false,
  robinhood_v41_phase_b_evidence: false,
  robinhood_v41_phase_b_evidence_exact: false,
  robinhood_v413_runtime_evidence: false,
  robinhood_v413_runtime_evidence_exact: false,
  robinhood_v414_runtime_evidence: false,
  robinhood_v414_runtime_evidence_exact: false,
});

const FULL_SCOPE_KEYS = Object.freeze([
  "contracts",
  "custom_v2",
  "database",
  "dependencies",
  "indexer",
  "interface",
  "read_model",
]);

export const ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS = Object.freeze([
  "release/robinhood-chain-4663/backend-promotion-input.attestation.json",
  "release/robinhood-chain-4663/backend-promotion-input.public.json",
]);

const ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATH_SET = new Set(
  ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS,
);

export const ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATHS = Object.freeze([
  "release/robinhood-chain-4663/v4.1/backend-promotion-input.attestation.json",
  "release/robinhood-chain-4663/v4.1/backend-promotion-input.public.json",
]);

const ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATH_SET = new Set(
  ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATHS,
);

export const ROBINHOOD_V413_RUNTIME_BACKEND_EVIDENCE_PATHS = Object.freeze([
  "release/robinhood-chain-4663/v4.1.3/backend-promotion-input.attestation.json",
  "release/robinhood-chain-4663/v4.1.3/backend-promotion-input.public.json",
]);

const ROBINHOOD_V413_RUNTIME_BACKEND_EVIDENCE_PATH_SET = new Set(
  ROBINHOOD_V413_RUNTIME_BACKEND_EVIDENCE_PATHS,
);

export const ROBINHOOD_V414_RUNTIME_BACKEND_EVIDENCE_PATHS = Object.freeze([
  "release/robinhood-chain-4663/v4.1.4/backend-promotion-input.attestation.json",
  "release/robinhood-chain-4663/v4.1.4/backend-promotion-input.public.json",
]);

const ROBINHOOD_V414_RUNTIME_BACKEND_EVIDENCE_PATH_SET = new Set(
  ROBINHOOD_V414_RUNTIME_BACKEND_EVIDENCE_PATHS,
);

export const ROBINHOOD_V41_CLI_COORDINATE_PATH =
  "docs/operations/releases/custom-launch-v4.1/clean-room-release-coordinate.json";

// This optimization proves the complete before/after bytes, not just a path
// match. Anything outside the two existing URL literals remains a full check.
export const INTERFACE_GUIDANCE_LITERAL_PATHS = Object.freeze([
  "lib/custom-launch/v4-public-contract-discovery.ts",
  "tests/public-robinhood-v41-agent-docs.test.ts",
]);
export const INTERFACE_GUIDANCE_MARKDOWN_PATHS = Object.freeze([
  "public/developers/custom-launch-api-v1.md",
  "docs/public/developers/custom-launch.md",
]);
const GUIDANCE_LINE_PATTERNS = [
  /^    guideUrl: `\$\{SITE_ORIGIN\}(\/developers\/[A-Za-z0-9][A-Za-z0-9/_-]*\.md)`,\n/gmu,
  /^      robinhoodGuide: "https:\/\/programmable\.market(\/developers\/[A-Za-z0-9][A-Za-z0-9/_-]*\.md)",\n/gmu,
];

function readGitChange(file, { baseSha, headSha }, allowUnchanged = false) {
  const git = (args) => execFileSync("git", args, { maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const text = (buffer) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  const status = text(git(["diff", "--no-renames", "--name-status", "-z", baseSha, headSha, "--", file]));
  if (status !== `M\0${file}\0` && !(allowUnchanged && status === "")) throw new Error("Guidance paths must be modified existing files.");
  return [baseSha, headSha].map((sha) => {
    const entry = text(git(["ls-tree", "-z", sha, "--", file]));
    if (!new RegExp(`^100644 blob [a-f0-9]{40}\\t${file.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\x00$`, "u").test(entry)) {
      throw new Error("Guidance paths must retain their regular-file mode.");
    }
    return text(git(["show", `${sha}:${file}`]));
  });
}

const TOOLING_ROOTS = new Set(["eslint", "eslint-config-next", "vitest", "@playwright/test", "typescript"]);
const canonical = (value) => JSON.stringify(value && typeof value === "object"
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]))
  : value);

function dependencyClosure(lock, names) {
  const packages = lock.packages;
  if (lock.lockfileVersion !== 3 || !packages?.[""]) throw new Error("Complete npm v3 lock required");
  const found = new Set();
  function visit(from, name, optional = false) {
    let parent = from;
    for (;;) {
      const target = `${parent ? parent + "/" : ""}node_modules/${name}`;
      const entry = packages[target];
      if (entry) {
        if (entry.link) throw new Error("Linked dependencies require full verification");
        if (found.has(target)) return;
        found.add(target);
        for (const dep of Object.keys(entry.dependencies ?? {})) visit(target, dep);
        for (const dep of Object.keys(entry.optionalDependencies ?? {})) visit(target, dep, true);
        // Installed peers can affect a consumer even when npm marks them dev.
        for (const dep of Object.keys(entry.peerDependencies ?? {})) visit(target, dep, true);
        return;
      }
      if (!parent) break;
      parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "";
    }
    if (!optional) throw new Error("Unresolved dependency");
  }
  for (const name of names) visit("", name);
  return found;
}

/** Prove a tool update changes no installed production dependency or compiler input. */
export function isToolingOnlyDependencyChange(paths, { baseSha, headSha,
  readChange = (file, range) => readGitChange(file, range, true) } = {}) {
  if (!/^[a-f0-9]{40}$/u.test(baseSha ?? "") || !/^[a-f0-9]{40}$/u.test(headSha ?? "") || baseSha === headSha
    || !Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length || !paths.includes("package-lock.json")
    || paths.some(path => !["package.json", "package-lock.json"].includes(path))) return false;
  try {
    const [beforePackage, afterPackage] = readChange("package.json", { baseSha, headSha }).map(JSON.parse);
    const [before, after] = readChange("package-lock.json", { baseSha, headSha }).map(JSON.parse);
    const withoutPackages = ({ packages, ...rest }) => rest;
    if (canonical(withoutPackages(before)) !== canonical(withoutPackages(after))) return false;
    const withoutDev = ({ devDependencies, overrides, ...rest }) => rest;
    if (canonical(withoutDev(beforePackage)) !== canonical(withoutDev(afterPackage))) return false;
    const devNames = new Set([...Object.keys(beforePackage.devDependencies ?? {}), ...Object.keys(afterPackage.devDependencies ?? {})]);
    if ([...devNames].some(name => beforePackage.devDependencies?.[name] !== afterPackage.devDependencies?.[name]
      && (!TOOLING_ROOTS.has(name) || !beforePackage.devDependencies?.[name] || !afterPackage.devDependencies?.[name]))) return false;
    const root = lock => ({ ...lock.packages[""], devDependencies: {} });
    if (canonical(root(before)) !== canonical(root(after))) return false;
    const runtimeNames = Object.keys({ ...beforePackage.dependencies, ...beforePackage.optionalDependencies, ...beforePackage.peerDependencies });
    const oldRuntime = dependencyClosure(before, runtimeNames), newRuntime = dependencyClosure(after, runtimeNames);
    if (canonical([...oldRuntime].sort()) !== canonical([...newRuntime].sort())) return false;
    for (const path of oldRuntime) if (canonical(before.packages[path]) !== canonical(after.packages[path])) return false;
    const oldTools = dependencyClosure(before, [...TOOLING_ROOTS].filter(name => beforePackage.devDependencies?.[name]));
    const newTools = dependencyClosure(after, [...TOOLING_ROOTS].filter(name => afterPackage.devDependencies?.[name]));
    const changed = [...new Set([...Object.keys(before.packages), ...Object.keys(after.packages)])]
      .filter(path => path && canonical(before.packages[path] ?? null) !== canonical(after.packages[path] ?? null));
    if (!changed.length) return false;
    const changedNames = new Set();
    for (const path of changed) {
      if ((!oldTools.has(path) && !newTools.has(path)) || oldRuntime.has(path) || newRuntime.has(path)) return false;
      for (const entry of [before.packages[path], after.packages[path]].filter(Boolean)) {
        if (entry.dev !== true || entry.link || entry.hasInstallScript || !entry.version
          || !/^https:\/\/registry\.npmjs\.org\/[^?#]+\.tgz$/u.test(entry.resolved ?? "") || !/^sha512-/u.test(entry.integrity ?? "")) return false;
      }
      changedNames.add(path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length));
    }
    for (const key of new Set([...Object.keys(beforePackage.overrides ?? {}), ...Object.keys(afterPackage.overrides ?? {})])) {
      const a = beforePackage.overrides?.[key], b = afterPackage.overrides?.[key];
      if (canonical(a ?? null) === canonical(b ?? null)) continue;
      const name = key.replace(/(?<!^)@[^/]*$/u, "");
      if (!changedNames.has(name) || [a, b].some(value => value !== undefined && (typeof value !== "string" || !/^\d+\.\d+\.\d+$/u.test(value)))) return false;
    }
    return true;
  } catch { return false; }
}

function isPresentationPath(file) {
  return /^(?:app|components)\/(?!api\/).*\.css$/u.test(file)
    || /^(?:app|components)\/(?!api\/).*\.tsx$/u.test(file)
    || /^(?:assets|public)\/.*\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?)$/u.test(file)
    || /^public\/developers\/[^/]+\.md$/u.test(file);
}

export function isInterfacePresentationCandidate(paths, scope = classifyVerifyPaths(paths)) {
  return paths.length > 0 && new Set(paths).size === paths.length
    && scope.interface === true
    && Object.entries(scope).every(([key, value]) => key === "interface" || value === false)
    && paths.every(isPresentationPath);
}

function presentationCodeShape(source) {
  // The locked parser is needed only for TSX copy edits. Code, imports, event
  // handlers, URLs and transaction values retain their exact syntax tree.
  const ts = createRequire(resolve("package.json"))("typescript");
  const file = ts.createSourceFile("ui.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (file.parseDiagnostics.length) throw new Error("Invalid TSX");
  const copyAttributes = new Set(["title", "alt", "placeholder", "aria-label", "aria-description"]);
  const copyContainers = new Set(["a", "article", "aside", "b", "button", "caption", "dd", "details",
    "div", "dt", "em", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
    "header", "i", "label", "legend", "li", "main", "nav", "ol", "p", "section", "small", "span",
    "strong", "summary", "td", "th", "ul"]);
  function isDisplayCopy(node, attribute = false) {
    const owner = ts.isJsxAttribute(node.parent) ? node.parent.parent.parent : node.parent;
    const element = ts.isJsxExpression(owner) ? owner.parent : owner;
    const tag = ts.isJsxElement(element) ? element.openingElement.tagName
      : ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName : null;
    const name = tag?.getText(file);
    // Script text is executable; option/textarea text can be a form value.
    // Custom component props and children may be transaction inputs.
    if (!copyContainers.has(name) && !(attribute && ["img", "input", "textarea"].includes(name))) return false;
    for (let parent = element.parent; parent; parent = parent.parent) {
      if (ts.isJsxElement(parent) && !copyContainers.has(parent.openingElement.tagName.getText(file))) return false;
    }
    return true;
  }
  function shape(node) {
    if (ts.isJsxText(node) && isDisplayCopy(node)) return [node.kind, "copy"];
    if (ts.isStringLiteral(node) && (
      (ts.isJsxAttribute(node.parent) && copyAttributes.has(node.parent.name.getText(file)) && isDisplayCopy(node, true))
      || (ts.isJsxExpression(node.parent) && node.parent.expression === node
        && isDisplayCopy(node))
    )) return [node.kind, "copy"];
    const children = [];
    node.forEachChild((child) => { children.push(shape(child)); });
    return [node.kind, children.length ? children : node.getText(file)];
  }
  return JSON.stringify(shape(file));
}

export function isInterfacePresentationOnlyChange(paths, {
  baseSha, headSha, scope = classifyVerifyPaths(paths), readChange = readGitChange,
  validateFile = (file) => {
    for (const sha of [baseSha, headSha]) {
      const entry = execFileSync("git", ["ls-tree", "-z", sha, "--", file], { encoding: "utf8" });
      if (entry && !entry.startsWith("100644 blob ")) throw new Error("Regular UI files required");
    }
  },
} = {}) {
  if (!/^[a-f0-9]{40}$/u.test(baseSha ?? "") || !/^[a-f0-9]{40}$/u.test(headSha ?? "")
    || baseSha === headSha || !isInterfacePresentationCandidate(paths, scope)) return false;
  try {
    for (const file of paths) {
      validateFile(file);
      if (!file.endsWith(".tsx")) continue;
      const [before, after] = readChange(file, { baseSha, headSha });
      if (before === after || presentationCodeShape(before) !== presentationCodeShape(after)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isInterfaceGuidanceOnlyChange(paths, {
  baseSha,
  headSha,
  scope = classifyVerifyPaths(paths),
  readChange = readGitChange,
} = {}) {
  if (!/^[a-f0-9]{40}$/u.test(baseSha ?? "") || !/^[a-f0-9]{40}$/u.test(headSha ?? "")
    || baseSha === headSha || scope.interface !== true
    || Object.entries(scope).some(([key, value]) => key !== "interface" && value !== false)) return false;
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0 || uniquePaths.length !== paths.length
    || !uniquePaths.some((file) => INTERFACE_GUIDANCE_LITERAL_PATHS.includes(file))) return false;
  try {
    for (const file of uniquePaths) {
      const literalIndex = INTERFACE_GUIDANCE_LITERAL_PATHS.indexOf(file);
      if (literalIndex === -1 && !INTERFACE_GUIDANCE_MARKDOWN_PATHS.includes(file)) return false;
      const [before, after] = readChange(file, { baseSha, headSha });
      if (typeof before !== "string" || typeof after !== "string" || before === after) return false;
      if (literalIndex === -1) continue;
      const pattern = GUIDANCE_LINE_PATTERNS[literalIndex];
      const oldMatches = [...before.matchAll(pattern)];
      const newMatches = [...after.matchAll(pattern)];
      if (oldMatches.length !== 1 || newMatches.length !== 1) return false;
      const withoutUrl = (content, match) => content.slice(0, match.index)
        + match[0].replace(match[1], "/GUIDANCE_URL") + content.slice(match.index + match[0].length);
      if (withoutUrl(before, oldMatches[0]) !== withoutUrl(after, newMatches[0])) return false;
    }
    return true;
  } catch {
    // Missing history, deleted/renamed files, invalid bytes, or unreadable Git
    // objects never select reduced coverage.
    return false;
  }
}

const CUSTOM_V2_EXACT_PATHS = new Set([
  "config/custom-registry-v2.deployment.prelaunch.json",
  "config/generic-launch-foundation.prelaunch.v1.json",
  "config/generic-launch-foundation.v1.schema.json",
  "config/generic-launch-public.v2.schema.json",
  "docs/operations/WEBSITE-PROJECTION-DATABASE-BACKEND-HANDOFF-V1.json",
  "lib/custom-launch/registry-public-manifest-v2.ts",
  "lib/data-pipeline/custom-registry-v2-event-manifest.ts",
  "lib/server/custom-launch/registry-manifest-v2.ts",
  "lib/server/projection-target/approval-v3-target.ts",
  "scripts/custom-v2-read-model-contract-v2.mjs",
  "scripts/custom-v2-stage-gate.mjs",
  "scripts/custom-v2-signer-probe-gate.mjs",
  "scripts/read-bounded-response.mjs",
  "scripts/reconcile-generic-signer-probe-deployments.mjs",
  "scripts/test/custom-v2-read-model-contract-v2.test.mjs",
  "scripts/test/custom-v2-signer-probe-gate.test.mjs",
  "scripts/test/read-bounded-response.test.mjs",
  "scripts/test/reconcile-generic-signer-probe-deployments.test.mjs",
  "scripts/test/custom-v2-stage-gate.test.mjs",
  "scripts/test/custom-v2-production-workflow-contract.test.mjs",
]);

// These operators have Interface regression coverage and change no Solidity,
// backend, database or indexer inputs.
const OWNER_PUBLICATION_PATHS = new Set([
  "ops/module-owner-publication/main.ts",
  "ops/module-owner-publication/journal.ts",
  "ops/module-owner-publication/operator.mjs",
  "ops/module-owner-publication/README.md",
  "scripts/publish-website-ui.mjs",
  "scripts/test/publish-website-ui.test.mjs",
]);

function isCustomV2OnlyPath(path) {
  return CUSTOM_V2_EXACT_PATHS.has(path)
    || /^app\/api\/custom-launch\/(?:generic|registry)\/v2\//u.test(path)
    || /^app\/api\/ops\/custom-launch\/generic-v2-(?:projector|signer-probe)\//u.test(path)
    || /^app\/v2\/internal\/projections\/approval-descriptors\//u.test(path)
    || /^app\/custom-launches\//u.test(path)
    || /^components\/generic-launch-directory-v2(?:\.module\.css|\.tsx)$/u.test(path)
    || /^lib\/server\/custom-launch\/generic-launch-[^/]*-v[12]\.ts$/u.test(path)
    || /^tests\/(?:approval-v3-artifact-projection-target|custom-registry-v2-(?:bindings|public-release)|generic-launch-(?:postgres-v2|projector-v2|read-production-probe-v1|read-signer-v2|read-v2|record-v2))\.test\.ts$/u.test(path);
}

export const CONTRACT_RELEASE_TEST_PATHS = Object.freeze([
  "tests/classic-v3-deployment-sequence.test.ts",
  "tests/deep-release-verifier.test.ts",
  "tests/deep-v2-release-verifier.test.ts",
  "tests/module-foundation-economic-modules.test.ts",
]);

export const DATABASE_RUNTIME_TEST_PATHS = Object.freeze([
  "tests/website-projection-target.test.ts",
]);

export const DATABASE_RUNTIME_SOURCE_PATHS = Object.freeze([
  "lib/server/custom-launch/genesis-canary-public-v1.ts",
  "lib/server/custom-launch/project-read-v2.ts",
  "lib/server/custom-launch/public-readiness.ts",
  "lib/server/custom-launch/registry-public-read-v1.ts",
  "lib/server/custom-launch/registry-public-store-v1.ts",
]);

export const READ_MODEL_CONTRACT_DOC_PATHS = Object.freeze([
  "docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md",
  "docs/operations/read-model-scheduler-cutover.md",
]);

function markAll(scope) {
  for (const key of FULL_SCOPE_KEYS) {
    scope[key] = true;
  }
}

export function classifyVerifyPaths(
  paths,
  { forceAll = false, customV2Release = false, toolingOnlyDependency = false, customAITracingOnly = false } = {},
) {
  const scope = { ...EMPTY_SCOPE };
  if (typeof customV2Release !== "boolean") {
    throw new TypeError("Custom V2 release classification must be boolean");
  }
  if (forceAll) {
    markAll(scope);
    return scope;
  }

  if (!customV2Release && toolingOnlyDependency === true && paths.length > 0
    && paths.every(path => ["package.json", "package-lock.json"].includes(path))) {
    // Preserve all JavaScript/application/database/CLI validation. Proven
    // tooling-only changes cannot alter the pinned Solidity or indexer trees.
    return { ...scope, interface: true, dependencies: true, database: true, custom_v2: true, read_model: true };
  }

  // A manual Generic V2 production release verifies the complete, current
  // Custom V2 tree, even when the production tip's last diff was unrelated.
  // This is a distinct verification intent, not a changed-path claim.
  if (customV2Release) scope.custom_v2 = true;

  const uniquePaths = new Set(paths.filter(Boolean));
  const robinhoodEvidencePaths = [...uniquePaths].filter((candidate) =>
    ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATH_SET.has(candidate));
  scope.robinhood_phase_b_evidence = robinhoodEvidencePaths.length > 0;
  scope.robinhood_phase_b_evidence_exact =
    uniquePaths.size === ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS.length
    && robinhoodEvidencePaths.length === ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS.length;
  const robinhoodV41EvidencePaths = [...uniquePaths].filter((candidate) =>
    ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATH_SET.has(candidate));
  scope.robinhood_v41_phase_b_evidence = robinhoodV41EvidencePaths.length > 0;
  scope.robinhood_v41_phase_b_evidence_exact =
    uniquePaths.size === ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATHS.length
    && robinhoodV41EvidencePaths.length === ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATHS.length;
  const robinhoodV413RuntimePaths = [...uniquePaths].filter((candidate) =>
    ROBINHOOD_V413_RUNTIME_BACKEND_EVIDENCE_PATH_SET.has(candidate));
  scope.robinhood_v413_runtime_evidence = robinhoodV413RuntimePaths.length > 0;
  scope.robinhood_v413_runtime_evidence_exact =
    uniquePaths.size === ROBINHOOD_V413_RUNTIME_BACKEND_EVIDENCE_PATHS.length
    && robinhoodV413RuntimePaths.length === ROBINHOOD_V413_RUNTIME_BACKEND_EVIDENCE_PATHS.length;
  const robinhoodV414RuntimePaths = [...uniquePaths].filter((candidate) =>
    ROBINHOOD_V414_RUNTIME_BACKEND_EVIDENCE_PATH_SET.has(candidate));
  scope.robinhood_v414_runtime_evidence = robinhoodV414RuntimePaths.length > 0;
  scope.robinhood_v414_runtime_evidence_exact =
    uniquePaths.size === ROBINHOOD_V414_RUNTIME_BACKEND_EVIDENCE_PATHS.length
    && robinhoodV414RuntimePaths.length === ROBINHOOD_V414_RUNTIME_BACKEND_EVIDENCE_PATHS.length;

  for (const path of paths) {
    if (!path) continue;

    // Each version's short-lived, cryptographically attested evidence pair has
    // a dedicated protected Contracts check. These checks reject partial, mixed,
    // and cross-version imports and verify the exact subject, Sigstore identity,
    // stage binding, and unchanged ten-minute authorization window before merge.
    if (ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATH_SET.has(path)
      || ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATH_SET.has(path)
      || ROBINHOOD_V413_RUNTIME_BACKEND_EVIDENCE_PATH_SET.has(path)
      || ROBINHOOD_V414_RUNTIME_BACKEND_EVIDENCE_PATH_SET.has(path)) continue;

    // This exact JSON document selects an immutable CLI release; it does not
    // change Solidity, database, indexer, or dependency inputs. The Interface
    // lane builds its public discovery consumer and authenticates the complete
    // V4.1 coordinate/activation closure, including producer and asset hashes.
    // Schemas, sibling release records, verifier changes, and mixed code
    // changes still select their own full gates below.
    if (path === ROBINHOOD_V41_CLI_COORDINATE_PATH) {
      scope.interface = true;
      continue;
    }

    // This closed generation-2 surface has its own production proof and
    // staged health contract. In particular, flipping the versioned Registry
    // deployment binding must not pay Classic, Stock, Explore, or the global
    // market read-model gates.
    if (isCustomV2OnlyPath(path)) {
      scope.custom_v2 = true;
      continue;
    }
    if (OWNER_PUBLICATION_PATHS.has(path)) {
      scope.interface = true;
      continue;
    }

    // Isolated Custom AI workers are covered by the pinned real-EVM tests,
    // exact pack/receipt consumers and Custom AI browser/build lane. Unchanged
    // platform contracts, database and indexer have no input edge from here.
    if (isGeneralConstructorWorker(path) || GENERAL_BEHAVIOR_WORKERS.includes(path)
      || path === "next.config.ts" && customAITracingOnly === true) {
      scope.interface = true;
      continue;
    }

    if (
      /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|bun\.lock|tsconfig[^/]*\.json|next\.config\.[^/]+|eslint\.config\.[^/]+|vitest\.config\.[^/]+)$/u.test(
        path,
      ) ||
      /^(?:\.github|config|ops|releases|scripts)\//u.test(path) ||
      /^(?:docs\/(?:operations\/releases|security)|lib\/vendor)\//u.test(
        path,
      ) ||
      /^(?:Dockerfile|docker-compose\.ya?ml)$/u.test(path)
    ) {
      markAll(scope);
      continue;
    }

    if (READ_MODEL_CONTRACT_DOC_PATHS.includes(path)) {
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (
      /^(?:(?:README|AGENTS|CONTRIBUTING|SECURITY|SUPPORT|CODE_OF_CONDUCT)\.md|LICENSE)$/u.test(
        path,
      ) ||
      /^docs\//u.test(path)
    ) {
      continue;
    }

    if (/^(?:contracts\/|foundry\.toml$|remappings\.txt$|scripts\/test\/any-quote-(?:route-price\.test\.mjs|route-runtime\.test\.mjs|route-permit2\.hex|readiness-discovery\.test\.mjs)$)/u.test(path)) {
      scope.contracts = true;
      scope.interface = true;
      continue;
    }

    if (/^supabase\//u.test(path)) {
      scope.database = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (
      DATABASE_RUNTIME_TEST_PATHS.includes(path) ||
      DATABASE_RUNTIME_SOURCE_PATHS.includes(path) ||
      /^lib\/server\/projection-target\//u.test(path)
    ) {
      scope.database = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (CONTRACT_RELEASE_TEST_PATHS.includes(path)) {
      scope.contracts = true;
      scope.interface = true;
      continue;
    }

    if (/^indexer\//u.test(path)) {
      scope.indexer = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (path === "lib/data-pipeline/postgres.ts") {
      scope.database = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (/^lib\/onchain\//u.test(path)) {
      scope.contracts = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (
      /^(?:app|assets|components|lib|public|tests)\//u.test(path) ||
      /^(?:next-env\.d\.ts|vercel\.json)$/u.test(path)
    ) {
      scope.interface = true;
      if (
        /^(?:app\/api\/(?:explore|ops)\/|lib\/data-pipeline\/)/u.test(path) ||
        /^lib\/market-data\//u.test(path) ||
        path === "lib/explore-financial-data.ts" ||
        path === "vercel.json"
      ) {
        scope.read_model = true;
      }
      continue;
    }

    // New or unknown surfaces fail safe until they are explicitly classified.
    markAll(scope);
  }

  return scope;
}

function printGithubOutputs(scope) {
  for (const [key, value] of Object.entries(scope)) {
    console.log(`${key}=${value}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const forceAll = process.argv[2] === "--all";
  const customV2Release = process.argv[2] === "--custom-v2-release";
  if ((forceAll || customV2Release) && process.argv.length !== 3) {
    throw new Error("Verify scope mode does not accept a path file");
  }
  if (!forceAll && !customV2Release && process.argv.length !== 3) {
    throw new Error("Exactly one changed-path file is required");
  }
  const paths = forceAll || customV2Release
    ? []
    : readFileSync(process.argv[2], "utf8")
        .split("\n")
        .map((path) => path.trim())
        .filter(Boolean);
  const toolingOnlyDependency = !forceAll && !customV2Release && isToolingOnlyDependencyChange(paths,
    { baseSha: process.env.BASE_SHA, headSha: process.env.HEAD_SHA });
  const customAITracingOnly = !forceAll && !customV2Release && isCustomAITracingOnlyChange(paths,
    { baseSha: process.env.BASE_SHA, headSha: process.env.HEAD_SHA });
  const scope = classifyVerifyPaths(paths, { forceAll, customV2Release, toolingOnlyDependency, customAITracingOnly });
  printGithubOutputs({ ...scope,
    interface_presentation_candidate: !forceAll && !customV2Release && isInterfacePresentationCandidate(paths, scope),
    interface_presentation_only: !forceAll && !customV2Release
      && isInterfacePresentationOnlyChange(paths, { scope, baseSha: process.env.BASE_SHA, headSha: process.env.HEAD_SHA }),
    interface_guidance_only: !forceAll && !customV2Release
    && isInterfaceGuidanceOnlyChange(paths, { scope, baseSha: process.env.BASE_SHA, headSha: process.env.HEAD_SHA }) });
}
