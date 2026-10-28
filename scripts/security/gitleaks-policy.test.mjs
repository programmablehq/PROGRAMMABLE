import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

const binary = process.env.PROGRAMMABLE_GITLEAKS_BINARY;
const config = fileURLToPath(new URL("../../.gitleaks.toml", import.meta.url));
const creationHash = "0x445809d9f7a34e959de4a96dec1e1beddfb265755bf28c57c42744adea1128ef";
const reviewAsset = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const nativeReviewAsset = "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9";
const nativeHistory = "config/module-engine/historical-releases.json";
const quoteReview = "config/module-engine/review-release.any-quote.json";
const material = createHash("sha256").update("gitleaks negative control only").digest("hex");
const catalog = "config/module-engine/catalog.json";
const anyQuoteIndexFixtures = [
  "tests/fixtures/module-engine-any-quote-index.json",
  "tests/fixtures/module-engine-any-quote-eth-index.json",
];
const anyQuoteEthBasis = "contracts/scripts/module-engine/any-quote-eth-basis.mjs";
const visibilityTest = "tests/robinhood-website-index.test.ts";
const completedLaunchTest = "tests/module-foundation-launch-status.test.tsx";
const completedLaunchCoin = "0x2CCE608219d32eA1Eb6c7EA4d04a0eACd1F08da9";
const recentLaunchTest = "tests/module-foundation-recent-launches.test.ts";
const anyQuoteCanary = "0xb36271399c031ce270e0d1eed5f26dcd08367119";
const pairTokenPackage = "public/developers/modules/0xa51c62d66f474e63d68e35e5d9596612ed226811799a9f8fd8489ac85091f2bd";
const pairTokenPublicPaths = [`${pairTokenPackage}/manifest.json`, `${pairTokenPackage}/source.json`];
// Public synthetic index evidence includes both sides of the final salt-domain correction.
const anyQuoteAddresses = [
  "0xd803cd624d58e1f31d1043f630953e6dbdf6a128",
  "0x38665576617c205e3cac17a3eefa8bd6475dcc34",
];
const [creation, runtime] = [
  "0xd2ee78b8bc95f6a8df6f94c6e4c0a49d77639f5b7697eaf06b0c6b6b38134766",
  "0x21f0bf03dc072ce066e4a72c64fee2b8178bcabc2a69853977b29c45240460c2",
];
const anyQuotePublicFields = [
  ...anyQuoteAddresses.flatMap((value) => [{ token: value }, { primaryToken: value }]),
  { tokenCreationCodeHash: creation },
  { tokenRuntimeCodeHash: runtime },
];
const hashPaths = [
  "config/module-engine/robinhood.json",
  "config/module-engine/index-releases.json",
  nativeHistory,
  catalog,
  quoteReview,
  "public/developers/modules/0x09c61111bdecf969b903653e8a9776d1ed103b9201fbd33526aaee9e1c8a07e2/manifest.json",
  "public/developers/modules/0x81185e910dec1032df4bd027f8139f524606f628c0a63dbae62c69bb86e470da/manifest.json",
  "public/developers/modules/0x616f4584f5ec576a88bac5b6d5ee1ae841713f02129ab71a9b47e7e900312b2f/manifest.json",
  "public/developers/modules/0xeec9f1128106907da53b9a729206a0ad78e1e6c0379fde31636a2986f9b03c08/manifest.json",
  ...pairTokenPublicPaths,
];

before(() => {
  assert.ok(binary, "Pass the checksum-verified CI binary as PROGRAMMABLE_GITLEAKS_BINARY");
  const version = spawnSync(binary, ["version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "8.30.1");
});

function scan(t, files, { raw = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "programmable-gitleaks-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, value] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    if (raw) assert.equal(typeof value, "string");
    writeFileSync(target, `${raw ? value : JSON.stringify(value)}\n`, { mode: 0o600 });
  }
  for (const args of [["init", "--quiet"], ["add", "--force", "--", ...Object.keys(files)]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const report = join(root, "findings.json");
  writeFileSync(report, "", { mode: 0o600 });
  const result = spawnSync(binary, [
    "git", root, "--pre-commit", "--staged", "--config", config,
    "--redact=100", "--no-banner", "--report-format", "json", "--report-path", report,
  ], { cwd: root, encoding: "utf8" });
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  const findings = JSON.parse(readFileSync(report, "utf8"))
    .map(({ File, RuleID }) => ({ File, RuleID }));
  assert.equal(result.status, findings.length === 0 ? 0 : 1);
  assert.ok(findings.every(({ RuleID }) => RuleID === "generic-api-key"));
  return findings;
}

function publicFields(path) {
  return {
    tokenCreationCodeHash: creationHash,
    ...(path === catalog ? { token: reviewAsset } : path === nativeHistory ? { token: nativeReviewAsset } : {}),
  };
}

function assertFiles(findings, paths, count = paths.length) {
  assert.equal(findings.length, count);
  assert.deepEqual([...new Set(findings.map(({ File }) => File))].sort(), [...paths].sort());
}

test("health monitoring allows only its exact public coin requests", t => {
  const path = "scripts/ops/production-health.mjs";
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const lines = source.split("\n").filter(line => line.includes("tokenAddress:") && line.includes("presentation?token="));
  assert.equal(lines.length, 2);
  assert.deepEqual(scan(t, { [path]: source }, { raw: true }), []);
  for (const line of lines) {
    const value = line.match(/tokenAddress: "([^"]+)"/)[1];
    assert.deepEqual(scan(t, { [path]: line }, { raw: true }), []);
    for (const rejected of [
      line.replaceAll(value, `0x${material.slice(0, 40)}`),
      `${line} const apiKey = "${material}";`,
      `const apiKey = "${value}";`,
      line.replace("programmable.market", "example.com"),
    ]) assert.ok(scan(t, { [path]: rejected }, { raw: true }).length > 0);
    assert.ok(scan(t, { [`${path}.backup`]: line }, { raw: true }).length > 0);
  }
});

test("Base discovery allows only its exact public WETH runtime commitment", t => {
  const paths = [
    "packages/launch/src/base-profile-v1.json",
    "docs/operations/releases/custom-launch-v4.2.0/cli-release-binding.json",
    "public/openapi/base-custom-launch-v1.json",
  ];
  const digest = JSON.parse(readFileSync(new URL("../../packages/launch/src/base-profile-v1.json", import.meta.url))).fundingTokenRuntimeCodeHash;
  const line = `  "fundingTokenRuntimeCodeHash": "${digest}",`;
  assert.deepEqual(scan(t, Object.fromEntries(paths.map(path => [path, line])), { raw: true }), []);
  for (const path of paths) {
    assertFiles(scan(t, { [path]: line.replace(digest, `0x${material}`) }, { raw: true }), [path]);
    assertFiles(scan(t, { [path]: `${line} "apiKey": "${material}",` }, { raw: true }), [path], 2);
    assertFiles(scan(t, { [`${path}.backup`]: line }, { raw: true }), [`${path}.backup`]);
  }
});

test("Eulerian public identity comparisons do not hide changed or adjacent credentials", t => {
  const path = "lib/server/robinhood-presentation.ts";
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const branch = source.slice(source.indexOf('&& address === "0x46d4'), source.indexOf('description: "Eulerian'));
  const lines = branch.split("\n").filter(line => /&& (token\.launchId|same\(token\.(hookAddress|poolId|creator))/.test(line));
  assert.equal(lines.length, 4);
  for (const line of lines) {
    const value = line.match(/"([^"]+)"/)[1];
    assert.deepEqual(scan(t, { [path]: line }, { raw: true }), []);
    assert.ok(scan(t, { [path]: line.replace(value, material) }, { raw: true }).length > 0);
    assert.ok(scan(t, { [path]: `const apiKey = "${value}";` }, { raw: true }).length > 0);
    assert.ok(scan(t, { [path]: `${line} const apiKey = "${material}";` }, { raw: true }).length > 0);
    assert.ok(scan(t, { [`${path}.backup`]: line }, { raw: true }).length > 0);
  }
});

test("atomic module lifecycle allows only its exact public evidence fields", (t) => {
  const path = "contracts/deployments/ethereum-module-foundation-v2.json";
  const fields = [
    ["canaryToken", "0xBB73F3Bb5CfAe5629F0a6a58bb10ab1e35e4c11a"],
    ["apiSourceCommit", "0f37c09734a4f433c1df618bd8a46a393a73b0f4"],
  ];
  for (const [field, value] of fields) {
    const line = `  "${field}": "${value}",`;
    assert.deepEqual(scan(t, { [path]: line }, { raw: true }), []);
    for (const rejected of [
      `  "${field}": "${material}",`,
      `  "apiKey": "${value}",`,
      `${line}\n  "apiKey": "${value}",`,
      `  "apiKey": "${value}",\n${line}`,
    ]) assertFiles(scan(t, { [path]: rejected }, { raw: true }), [path]);
    assertFiles(scan(t, { [`${path}.backup`]: line }, { raw: true }), [`${path}.backup`]);
    const fixturePath = "scripts/security/gitleaks-policy.test.mjs";
    const fixture = `    ["${field}", "${value}"],`;
    assert.deepEqual(scan(t, { [fixturePath]: fixture }, { raw: true }), []);
    assertFiles(scan(t, { [fixturePath]: fixture.replace(value, material) }, { raw: true }), [fixturePath]);
    assertFiles(scan(t, { [`${fixturePath}.backup`]: fixture }, { raw: true }), [`${fixturePath}.backup`]);
  }
});

test("recent launch visibility allows only the exact public coin field", (t) => {
  const coin = completedLaunchCoin.toLowerCase();
  const field = `tokenAddress: "${coin}"`;
  assert.deepEqual(scan(t, { [recentLaunchTest]: `const hidden = { ${field} };` }, { raw: true }), []);
  for (const fields of [`${field}, apiKey: "${coin}"`, `tokenAddress: "0x${material.slice(0, 40)}"`]) {
    assertFiles(scan(t, { [recentLaunchTest]: `const hidden = { ${fields} };` }, { raw: true }), [recentLaunchTest]);
  }
  const adjacent = `fixtures/${recentLaunchTest}`;
  assertFiles(scan(t, { [adjacent]: `const hidden = { ${field} };` }, { raw: true }), [adjacent]);
});

test("Ethereum compiler exports allow only the exact public source hash lines", (t) => {
  const paths = ["contracts/spec/module-foundation/ethereum-graph-bytecode.v1.json", "contracts/spec/module-foundation/ethereum-graph-bytecode.v2.json", "packages/module-foundation-ethereum/dist/index.mjs"];
  const digest = "0x28ad9a130f32c14d931da364f529c63a207b9476bfc19c67751d9df0d568397d";
  const line = `  "src/module-foundation/FoundationTokenV1.sol": "${digest}",`;
  assert.deepEqual(scan(t, Object.fromEntries(paths.map(path => [path, line])), { raw: true }), []);
  assertFiles(scan(t, Object.fromEntries(paths.map(path => [path, line.replace(digest, `0x${material}`)])), { raw: true }), paths);
  assertFiles(scan(t, Object.fromEntries(paths.map(path => [path, `"apiKey": "${digest}",`])), { raw: true }), paths);
  assertFiles(scan(t, { [`${paths[0]}.backup`]: line }, { raw: true }), [`${paths[0]}.backup`]);
});

test("accepts only the exact public coin field in the completed launch regression", (t) => {
  assert.deepEqual(scan(t, { [completedLaunchTest]: `metadata: { token: "${completedLaunchCoin}" }` }, { raw: true }), []);
  assertFiles(scan(t, { [completedLaunchTest]: `metadata: { token: "${completedLaunchCoin}", apiKey: "${completedLaunchCoin}" }` }, { raw: true }), [completedLaunchTest]);
  assertFiles(scan(t, { [completedLaunchTest]: `metadata: { token: "0x${material.slice(0, 40)}" }` }, { raw: true }), [completedLaunchTest]);
});

test("keeps the completed launch coin detectable in unlisted paths", (t) => {
  const paths = [completedLaunchTest.replace(".test.", "-next.test."), `${completedLaunchTest}.backup`];
  assertFiles(scan(t, Object.fromEntries(paths.map(path => [path, `metadata: { token: "${completedLaunchCoin}" }`])), { raw: true }), paths);
});

const foundationEvidencePath = "contracts/security/module-foundation-v2/local-checks.json";
const foundationTokenSourcePath = "src/module-foundation/FoundationTokenV1.sol";
const foundationTokenSourceHash = createHash("sha256").update(readFileSync(
  new URL("../../contracts/src/module-foundation/FoundationTokenV1.sol", import.meta.url),
)).digest("hex");
const foundationSourceLine = `    "${foundationTokenSourcePath}": "${foundationTokenSourceHash}",`;

test("accepts the Foundation evidence line bound to the actual public token source bytes", (t) => {
  const evidence = readFileSync(new URL(`../../${foundationEvidencePath}`, import.meta.url), "utf8");
  assert.ok(evidence.split("\n").includes(foundationSourceLine));
  assert.deepEqual(scan(t, { [foundationEvidencePath]: foundationSourceLine }, { raw: true }), []);
});

test("detects replacement material under the Foundation evidence source path", (t) => {
  assertFiles(scan(t, { [foundationEvidencePath]: foundationSourceLine.replace(foundationTokenSourceHash, material) }, { raw: true }), [foundationEvidencePath]);
});

test("keeps the Foundation source digest detectable under a credential field", (t) => {
  assertFiles(scan(t, { [foundationEvidencePath]: `"apiKey": "${foundationTokenSourceHash}",` }, { raw: true }), [foundationEvidencePath]);
});

test("detects credentials before and after the allowed Foundation source line", (t) => {
  for (const before of [true, false]) {
    const credential = `"apiKey": "${material}",`;
    const line = before ? `${credential} ${foundationSourceLine}` : `${foundationSourceLine} ${credential}`;
    assertFiles(scan(t, { [foundationEvidencePath]: line }, { raw: true }), [foundationEvidencePath], 2);
  }
});

test("keeps the Foundation source line detectable in adjacent and prefixed evidence paths", (t) => {
  const paths = [foundationEvidencePath.replace(".json", "-next.json"), `${foundationEvidencePath}.backup`, `fixtures/${foundationEvidencePath}`];
  assertFiles(scan(t, Object.fromEntries(paths.map(path => [path, foundationSourceLine])), { raw: true }), paths);
});

test("accepts exact Engine V1 public hash fields and the reviewed fixture address", (t) => {
  assert.deepEqual(scan(t, Object.fromEntries(hashPaths.map((path) => [path, publicFields(path)]))), []);
});

test("accepts the exact public creation hash inside the reviewed base64 source package", (t) => {
  const bytes = Buffer.from(JSON.stringify({ tokenCreationCodeHash: creationHash })).toString("base64");
  assert.deepEqual(scan(t, { [`${pairTokenPackage}/source.json`]: { files: [{ bytes }] } }), []);
});

test("detects credentials beside the allowed creation hash inside the base64 source package", (t) => {
  const path = `${pairTokenPackage}/source.json`;
  for (const apiKey of [material, creationHash]) {
    const bytes = Buffer.from(JSON.stringify({ tokenCreationCodeHash: creationHash, apiKey })).toString("base64");
    assertFiles(scan(t, { [path]: { files: [{ bytes }] } }), [path]);
  }
});

test("detects a generic credential before or after allowed fields on the same JSON line", (t) => {
  for (const before of [true, false]) {
    const files = Object.fromEntries(hashPaths.map((path) => [path, before
      ? { apiKey: material, ...publicFields(path) }
      : { ...publicFields(path), apiKey: material }]));
    assertFiles(scan(t, files), hashPaths);
  }
});

test("keeps the exact public values detectable under neighbouring credential fields", (t) => {
  const files = Object.fromEntries(hashPaths.map((path) => [path, {
    ...publicFields(path), apiKey: path === catalog ? reviewAsset : path === nativeHistory ? nativeReviewAsset : creationHash,
  }]));
  assertFiles(scan(t, files), hashPaths);
});

test("detects replacement values under the allowed field names", (t) => {
  const files = Object.fromEntries(hashPaths.map((path) => [path, {
    tokenCreationCodeHash: `0x${material}`,
    ...([catalog, nativeHistory].includes(path) ? { token: `0x${material.slice(0, 40)}` } : {}),
  }]));
  assertFiles(scan(t, files), hashPaths, hashPaths.length + 2);
});

test("keeps public values detectable in adjacent or unlisted paths", (t) => {
  const files = {
    "config/module-engine/robinhood-next.json": { tokenCreationCodeHash: creationHash },
    "config/module-engine/catalog-next.json": { token: reviewAsset },
    "config/module-engine/historical-releases-next.json": { token: nativeReviewAsset },
    [quoteReview.replace(".json", "-next.json")]: { tokenCreationCodeHash: creationHash },
    [`fixtures/${nativeHistory}`]: { token: nativeReviewAsset },
    "public/developers/modules/unreviewed/manifest.json": { tokenCreationCodeHash: creationHash },
    [`public/developers/modules/0x${"1".repeat(64)}/manifest.json`]: { tokenCreationCodeHash: creationHash },
    [`${hashPaths[2]}.backup`]: { tokenCreationCodeHash: creationHash },
    ...Object.fromEntries([quoteReview, ...pairTokenPublicPaths].flatMap((path) => [
      [`${path}.backup`, { tokenCreationCodeHash: creationHash }],
      [`fixtures/${path}`, { tokenCreationCodeHash: creationHash }],
    ])),
  };
  assertFiles(scan(t, files), Object.keys(files));
});

test("accepts exact current and historical public Any Quote index fixture fields", (t) => {
  assert.deepEqual(scan(t, Object.fromEntries(anyQuoteIndexFixtures.map((path) => [path, anyQuotePublicFields]))), []);
});

test("detects a credential beside all allowed Any Quote fields on the same JSON line", (t) => {
  assertFiles(scan(t, Object.fromEntries(anyQuoteIndexFixtures.map((path) => [path, {
    evidence: anyQuotePublicFields, apiKey: material,
  }]))), anyQuoteIndexFixtures);
});

test("keeps each exact Any Quote public value detectable under a credential field", (t) => {
  for (const fields of anyQuotePublicFields) {
    const value = Object.values(fields)[0];
    assertFiles(scan(t, Object.fromEntries(anyQuoteIndexFixtures.map((path) => [path, {
      ...fields, apiKey: value,
    }]))), anyQuoteIndexFixtures);
  }
});

test("detects replacement values under each allowed Any Quote field name", (t) => {
  for (const fields of anyQuotePublicFields) {
    const [field, value] = Object.entries(fields)[0];
    const replacement = `0x${material.slice(0, value.length - 2)}`;
    assertFiles(scan(t, Object.fromEntries(anyQuoteIndexFixtures.map((path) => [path, {
      [field]: replacement,
    }]))), anyQuoteIndexFixtures);
  }
});

test("keeps every Any Quote public fixture field detectable in adjacent and unlisted paths", (t) => {
  for (const fields of anyQuotePublicFields) {
    const files = {
      ...Object.fromEntries(anyQuoteIndexFixtures.flatMap((path) => [
        [path.replace(".json", "-next.json"), fields],
        [`${path}.backup`, fields],
      ])),
      "config/module-engine/any-quote-index.json": fields,
    };
    assertFiles(scan(t, files), Object.keys(files));
  }
});

test("accepts only the exact public creation commitment line in the native deployment basis", (t) => {
  assert.deepEqual(scan(t, {
    [anyQuoteEthBasis]: `  "tokenCreationCodeHash": "${creationHash}",`,
  }, { raw: true }), []);
});

test("detects a credential beside the native deployment basis commitment", (t) => {
  assertFiles(scan(t, {
    [anyQuoteEthBasis]: `  "tokenCreationCodeHash": "${creationHash}", "apiKey": "${material}"`,
  }, { raw: true }), [anyQuoteEthBasis], 2);
});

test("keeps the exact basis commitment detectable under a credential field", (t) => {
  assertFiles(scan(t, {
    [anyQuoteEthBasis]: `  "apiKey": "${creationHash}",`,
  }, { raw: true }), [anyQuoteEthBasis]);
});

test("detects a replacement creation commitment in the native deployment basis", (t) => {
  assertFiles(scan(t, {
    [anyQuoteEthBasis]: `  "tokenCreationCodeHash": "0x${material}",`,
  }, { raw: true }), [anyQuoteEthBasis]);
});

test("keeps the basis commitment detectable in adjacent and unlisted paths", (t) => {
  const files = Object.fromEntries([
    anyQuoteEthBasis.replace(".mjs", "-next.mjs"),
    `${anyQuoteEthBasis}.backup`,
    "contracts/scripts/module-engine/unreviewed-basis.mjs",
  ].map((path) => [path, `  "tokenCreationCodeHash": "${creationHash}",`]));
  assertFiles(scan(t, files, { raw: true }), Object.keys(files));
});

test("accepts the exact public Any Quote canary tokenAddress field in its visibility test", (t) => {
  assert.deepEqual(scan(t, {
    [visibilityTest]: `const launch = { tokenAddress: "${anyQuoteCanary}", name: "Any Quote LP Internal Test", symbol: "AQLPTEST" };`,
  }, { raw: true }), []);
});

test("keeps the public Any Quote canary detectable under a neighbouring credential field", (t) => {
  assertFiles(scan(t, {
    [visibilityTest]: `const launch = { tokenAddress: "${anyQuoteCanary}", apiKey: "${anyQuoteCanary}" };`,
  }, { raw: true }), [visibilityTest]);
});

test("detects a changed tokenAddress value in the canary visibility test", (t) => {
  assertFiles(scan(t, {
    [visibilityTest]: `const launch = { tokenAddress: "0x${material.slice(0, 40)}" };`,
  }, { raw: true }), [visibilityTest]);
});

test("keeps the exact canary field detectable in neighbouring and prefixed test paths", (t) => {
  const paths = ["tests/robinhood-website-index-next.test.ts", `${visibilityTest}.backup`, `fixtures/${visibilityTest}`];
  assertFiles(scan(t, Object.fromEntries(paths.map(path => [path,
    `const launch = { tokenAddress: "${anyQuoteCanary}" };`,
  ])), { raw: true }), paths);
});

test("detects another credential before or after the allowed canary field on the same line", (t) => {
  const publicField = `tokenAddress: "${anyQuoteCanary}"`, credential = `apiKey: "${material}"`;
  for (const fields of [`${publicField}, ${credential}`, `${credential}, ${publicField}`]) {
    assertFiles(scan(t, { [visibilityTest]: `const launch = { ${fields} };` }, { raw: true }), [visibilityTest]);
  }
});

test("Classic discovery permits only the exact historical public address assignment", t => {
  const path = "lib/market-data/classic-launch-proof.ts";
  const value = "0x7987f03462200b3d8a072e02c89a8a41dcb124ee";
  const line = `export const CLASSIC_MAIN_TOKEN = "${value}";`;
  assert.deepEqual(scan(t, { [path]: line }, { raw: true }), []);
  assertFiles(scan(t, { [path]: line.replace(value, material) }, { raw: true }), [path]);
  assertFiles(scan(t, { [path]: `const apiKey = "${value}";` }, { raw: true }), [path]);
  assertFiles(scan(t, { [`${path}.backup`]: line }, { raw: true }), [`${path}.backup`]);
});

test("fee100 compiler export permits exact public source hashes, not nearby credentials", t => {
  const path = "contracts/spec/module-foundation/ethereum-graph-bytecode.v4.json";
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  for (const name of ["FoundationTokenV1.sol", "PoolKey.sol"]) {
    const line = source.split("\n").find(value => value.includes(`${name}\":`));
    assert.ok(line);
    assert.deepEqual(scan(t, { [path]: line }, { raw: true }), []);
    assertFiles(scan(t, { [path]: line.replace(/0x[0-9a-f]{64}/, material) }, { raw: true }), [path]);
    assertFiles(scan(t, { [`${path}.backup`]: line }, { raw: true }), [`${path}.backup`]);
  }
});

test("Claus kernel exceptions permit only exact public source lines", t => {
  const manifest="contracts/src/claus-partner-v1/source-manifest.json";
  const source=readFileSync(new URL(`../../${manifest}`,import.meta.url),"utf8");
  for(const name of ["PoolKey.sol","ClausLaunchTokenV1.sol"]) {
    const line=source.split("\n").find(value=>value.includes(`${name}\":`));assert.ok(line);
    assert.deepEqual(scan(t,{[manifest]:line},{raw:true}),[]);
    assertFiles(scan(t,{[manifest]:line.replace(/0x[0-9a-f]{64}/,material)},{raw:true}),[manifest]);
    assertFiles(scan(t,{[`${manifest}.backup`]:line},{raw:true}),[`${manifest}.backup`]);
  }
  const hook="contracts/src/claus-partner-v1/ClausQuoteHookV1.sol";
  const line=readFileSync(new URL(`../../${hook}`,import.meta.url),"utf8").split("\n").find(value=>value.includes("int128 tokenDelta"));
  assert.ok(line);
  assert.deepEqual(scan(t,{[hook]:line},{raw:true}),[]);
  assertFiles(scan(t,{[hook]:`${line} const apiKey = \"${material}\";`},{raw:true}),[hook],2);
  const historical="const line="+JSON.stringify(line)+";";
  const self="scripts/security/gitleaks-policy.test.mjs";
  assert.deepEqual(scan(t,{[self]:historical},{raw:true}),[]);
  assertFiles(scan(t,{[self]:`${historical} const apiKey = \"${material}\";`},{raw:true}),[self],2);
});

for (const path of [
  "tests/fixtures/base-finalized-custom-launch-metadata-feed-v1.json",
  "docs/operations/releases/custom-launch-v4.2.0/base-live-acceptance.json",
]) test(`Base public token exception is confined to its exact line in ${path}`, t => {
  const source = readFileSync(new URL("../../tests/fixtures/base-finalized-custom-launch-metadata-feed-v1.json", import.meta.url), "utf8");
  const line = source.split("\n").find(value => value.trimStart().startsWith('"token": "0x'));
  assert.ok(line);
  assert.deepEqual(scan(t, { [path]: line }, { raw: true }), []);
  assertFiles(scan(t, { [path]: line.replace(/0x[0-9a-fA-F]{40}/, material) }, { raw: true }), [path]);
  assertFiles(scan(t, { [path]: line.replace('"token":', '"apiKey":') }, { raw: true }), [path]);
  assertFiles(scan(t, { [`${path}.backup`]: line }, { raw: true }), [`${path}.backup`]);
});

test("Custom AI source hash exceptions retain credential and path boundaries", t => {
  const paths = [
    "contracts/spec/custom-ai/verification-bundle/manifest.json",
    "scripts/custom-ai/core-bundle.json",
    "lib/custom-ai/program-code.json",
  ];
  const manifest = JSON.parse(readFileSync(new URL(`../../${paths[0]}`, import.meta.url), "utf8"));
  for (const path of paths) for (const name of ["lib/v4-core/src/types/PoolKey.sol", "src/custom-ai/CustomAITokenV1.sol"]) {
    const value = manifest.sourceSha256[name];
    const line = JSON.stringify({ [name]: value });
    assert.deepEqual(scan(t, { [path]: line }, { raw: true }), []);
    assertFiles(scan(t, { [path]: line.replace(value, material) }, { raw: true }), [path]);
    assertFiles(scan(t, { [path]: JSON.stringify({ [name]: value, apiKey: material }) }, { raw: true }), [path]);
    assertFiles(scan(t, { [`${path}.backup`]: line }, { raw: true }), [`${path}.backup`]);
  }
});

test("Custom AI funded evidence permits only the exact public token address lines", t => {
  const path = "docs/operations/custom-ai/funded-acceptance-20261022.json";
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const lines = source.split("\n").filter(line => line.trimStart().startsWith('"tokenAddress":'));
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.deepEqual(scan(t, { [path]: line }, { raw: true }), []);
    assertFiles(scan(t, { [path]: line.replace(/0x[0-9a-fA-F]{40}/, material) }, { raw: true }), [path]);
    assertFiles(scan(t, { [path]: line.replace('"tokenAddress":', '"apiKey":') }, { raw: true }), [path]);
    assertFiles(scan(t, { [path]: `${line} "apiKey": "${material}"` }, { raw: true }), [path], 2);
    assertFiles(scan(t, { [`${path}.backup`]: line }, { raw: true }), [`${path}.backup`]);
  }
});
