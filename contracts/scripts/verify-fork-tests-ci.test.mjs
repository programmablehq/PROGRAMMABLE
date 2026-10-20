import assert from "node:assert/strict";
import test from "node:test";
import { chains, runForkTests, splitForkTestGlob } from "./verify-fork-tests-ci.mjs";

const quiet = { log() {}, warn() {}, error() {} };
const expand = (glob) => glob.startsWith("test/{")
  ? glob.slice(6, -1).split(",").map((file) => `test/${file}`) : [glob];

test("bounded fork groups cover every original source file exactly once", () => {
  assert.deepEqual(chains.map((chain) => chain.testGlobs.flatMap(expand).length), [32, 6, 1]);
  for (const chain of chains) {
    const original = chain.testGlobs.flatMap(expand);
    const groups = chain.testGlobs.flatMap(splitForkTestGlob);
    assert.deepEqual(groups.flatMap(expand).sort(), [...original].sort());
    assert.equal(new Set(original).size, original.length);
    assert.ok(groups.every((group) => expand(group).length <= 10));
  }
  assert.equal(chains[0].testGlobs.flatMap(splitForkTestGlob).length, 5);
  const largeGroups = splitForkTestGlob(chains[0].testGlobs[0]).map(expand);
  for (const group of largeGroups) {
    assert.equal(group.filter((file) => /DeployMainnetStockPairedInfrastructureV[123]\.t\.sol$/u.test(file)).length, 1);
  }
});

test("invalid or duplicate selector paths cannot silently remove fork coverage", () => {
  for (const glob of ["test/../X.t.sol", "test/{X.t.sol,X.t.sol}", "test/{X.t.sol,}", "test/*.t.sol", "test/{}", "test/{../X.t.sol}"]) {
    assert.throws(() => splitForkTestGlob(glob), /Invalid explicit fork test inventory/u);
  }
});

test("the executable runner retains all groups, exact configured providers and timeouts", () => {
  const environment = { ETHEREUM_RPC_URL: "https://mainnet.example.invalid", SEPOLIA_RPC_URL: "https://sepolia.example.invalid", BASE_RPC_URL: "https://base.example.invalid" };
  const calls = [];
  assert.equal(runForkTests({ environment, logger: quiet, run: (...args) => { calls.push(args); return { status: 0 }; } }), 0);
  const expected = chains.flatMap((chain) => chain.testGlobs.flatMap(splitForkTestGlob)
    .map((glob) => ({ glob, key: chain.environmentKey })));
  assert.equal(calls.length, expected.length);
  for (const [index, [command, args, options]] of calls.entries()) {
    assert.equal(command, "forge");
    assert.deepEqual(args, ["test", "--match-path", expected[index].glob]);
    assert.equal(options.timeout, 90_000);
    assert.equal(options.env[expected[index].key], environment[expected[index].key]);
    assert.equal(options.stdio, "inherit");
    assert.deepEqual(Object.keys(options.env).sort(), Object.keys(environment).sort());
  }
});

test("a failed configured group cannot skip ahead, fall back or report success", () => {
  let calls = 0;
  const status = runForkTests({ environment: { ETHEREUM_RPC_URL: "https://mainnet.example.invalid" }, logger: quiet,
    run: () => ({ status: ++calls === 3 ? 7 : 0 }) });
  assert.equal(status, 1);
  assert.equal(calls, 3);
});

test("a provider retry restarts the complete chain inventory and exhaustion fails", () => {
  const calls = [];
  assert.equal(runForkTests({ environment: {}, logger: quiet, run: (...args) => {
    calls.push(args);
    return calls.length === 2 ? { status: null, error: { code: "ETIMEDOUT" } } : { status: 0 };
  } }), 0);
  assert.equal(calls[0][1][2], calls[2][1][2]);
  assert.equal(calls[0][2].env.ETHEREUM_RPC_URL, chains[0].publicEndpoints[0]);
  assert.equal(calls[2][2].env.ETHEREUM_RPC_URL, chains[0].publicEndpoints[1]);
  assert.equal(calls.length, 9);
  let failedCalls = 0;
  assert.equal(runForkTests({ environment: {}, logger: quiet, run: () => { failedCalls++; return { status: 1 }; } }), 1);
  assert.equal(failedCalls, chains[0].publicEndpoints.length);
});
