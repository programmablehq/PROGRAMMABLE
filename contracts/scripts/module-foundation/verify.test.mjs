import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const source = readFileSync(new URL("./verify.sh", import.meta.url), "utf8");
const pins = Object.fromEntries([...source.matchAll(/^verify_pin ([a-z0-9-]+) ([a-f0-9]{40})$/gm)].map(match => [match[1], match[2]]));

/** Run the real shell orchestrator with inert local git/cast/forge executables; no RPC or contract execution occurs. */
function run(environment = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "foundation-verification-test-"));
  try {
    const bin = path.join(directory, "bin"), scripts = path.join(directory, "contracts/scripts/module-foundation");
    mkdirSync(bin); mkdirSync(scripts, { recursive: true });
    writeFileSync(path.join(scripts, "verify.sh"), source);
    const log = path.join(directory, "calls.jsonl");
    const executable = (name, body) => {
      const file = path.join(bin, name);
      writeFileSync(file, `#!${process.execPath}\n${body}\n`); chmodSync(file, 0o755);
    };
    executable("git", `const args=process.argv.slice(2), pins=${JSON.stringify(pins)};
      if(args.includes('diff')) process.exit(process.env.STUB_DIRTY==='1'?1:0);
      const dependency=args[1].split('/').at(-1);
      if(!pins[dependency]) process.exit(1);
      process.stdout.write(process.env.STUB_BAD_PIN==='1'?'0'.repeat(40):pins[dependency]);`);
    executable("cast", `const fs=require('node:fs');
      fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({tool:'cast',args:process.argv.slice(2)})+'\\n');
      if(process.env.STUB_RPC_FAILED==='1') process.exit(1);
      process.stdout.write(process.env.STUB_BLOCK??'63715501');`);
    executable("forge", `const fs=require('node:fs');
      const command=process.argv[2];
      fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({tool:'forge',args:process.argv.slice(2),
        profile:process.env.FOUNDRY_PROFILE,rpc:process.env.FOUNDATION_RPC_URL,block:process.env.FOUNDATION_FORK_BLOCK,
        override:process.env.FOUNDRY_INVARIANT_RUNS??null,src:process.env.FOUNDRY_SRC??null})+'\\n');
      if(command===process.env.STUB_FAIL_COMMAND) process.exit(1);`);
    const result = spawnSync("bash", [path.join(scripts, "verify.sh")], {
      env: { PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`, ...environment },
      encoding: "utf8", timeout: 10_000,
    });
    let calls = [];
    try { calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); } catch { /* Pin checks can fail before a tool call. */ }
    assert.equal(result.error, undefined);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("complete Foundation verification fixes a public fork checkpoint and the committed compiler profile", () => {
  assert.equal(Object.keys(pins).length, 8);
  const result = run({ FOUNDRY_PROFILE: "default", FOUNDRY_SRC: "src/another", FOUNDRY_INVARIANT_RUNS: "1" });
  assert.equal(result.status, 0, result.stderr);
  const [capture, ...forge] = result.calls;
  assert.deepEqual(capture, { tool: "cast", args: ["block-number", "--rpc-url", "https://rpc.mainnet.chain.robinhood.com"] });
  assert.deepEqual(forge.map(call => call.args), [
    ["fmt", "--check", "src/module-foundation", "test/module-foundation"],
    ["lint", "src/module-foundation"],
    ["build", "src/module-foundation/FoundationFactoryV1.sol", "src/module-foundation/FoundationFactoryV2.sol", "src/module-foundation/FoundationFactoryV3Native.sol", "--sizes"],
    ["test", "--match-path", "test/module-foundation/*.t.sol", "-vv"],
  ]);
  for (const call of forge) assert.deepEqual({ profile: call.profile, rpc: call.rpc, block: call.block, override: call.override, src: call.src }, {
    profile: "module-foundation", rpc: "https://rpc.mainnet.chain.robinhood.com", block: "63715501", override: null, src: null,
  });
});

test("an explicitly selected public/archive checkpoint is preserved for every command", () => {
  const result = run({ FOUNDATION_RPC_URL: "https://archive.example.invalid", FOUNDATION_FORK_BLOCK: "63713262" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.some(call => call.tool === "cast"), false);
  for (const call of result.calls) assert.equal(call.block, "63713262");
  for (const call of result.calls) assert.equal(call.rpc, "https://archive.example.invalid");
});

test("missing RPC configuration resolves a real public endpoint and failed RPC access cannot become skipped test success", () => {
  const result = run({ FOUNDATION_RPC_URL: "", STUB_RPC_FAILED: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].tool, "cast");
  for (const block of ["0", "", "not-a-block"]) {
    const invalid = run({ STUB_BLOCK: block });
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.calls.some(call => call.tool === "forge"), false);
  }
});

test("changed dependencies and failed formatting, lint, build or tests fail the complete gate", () => {
  for (const environment of [{ STUB_BAD_PIN: "1" }, { STUB_DIRTY: "1" }]) {
    const result = run(environment); assert.notEqual(result.status, 0); assert.equal(result.calls.length, 0);
  }
  for (const command of ["fmt", "lint", "build", "test"]) {
    const result = run({ STUB_FAIL_COMMAND: command });
    assert.notEqual(result.status, 0); assert.equal(result.calls.at(-1).args[0], command);
  }
});
