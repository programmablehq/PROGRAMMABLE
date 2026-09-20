import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, multicall3Abi, parseAbiParameters } from "viem";
import { CHAIN_ID, TREASURY, MULTICALL, MULTICALL_HASH, MANAGER, MANAGER_HASH, LEDGER_ABI, CLAIM_DATA,
  buildClaimTransaction, parseReleases, validateLedger, verifySimulation, verifyClaimReceipt, confirmClaim } from "./module-mode-core.mjs";

const address = n => "0x" + n.toString(16).padStart(40, "0");
const hash = n => "0x" + n.toString(16).padStart(64, "0");
const account = address(100);
const claims = [{ ledger: address(1), quote: address(4), amount: 12n }, { ledger: address(2), quote: address(5), amount: 19n }];
const history = JSON.parse(await readFile(new URL("../../config/module-foundation/index-releases.json", import.meta.url), "utf8"));

test("one zero-value transaction claims every ledger without approvals or creator claims", () => {
  const transaction = buildClaimTransaction(account, claims);
  assert.equal(transaction.to, MULTICALL);
  assert.equal(transaction.value, "0x0");
  const decoded = decodeFunctionData({ abi: multicall3Abi, data: transaction.data });
  assert.equal(decoded.functionName, "aggregate3");
  assert.deepEqual(decoded.args[0], claims.map(claim => ({ target: claim.ledger, allowFailure: false, callData: CLAIM_DATA })));
});

test("empty, duplicate, zero and over-limit claims cannot enter the wallet transaction", () => {
  for (const list of [[], [claims[0], claims[0]], [{ ...claims[0], amount: 0n }], [{ ...claims[0], amount: 1n << 127n }],
    Array.from({ length: 129 }, (_, index) => ({ ledger: address(index + 1), amount: 1n }))]) {
    assert.throws(() => buildClaimTransaction(account, list));
  }
});

test("all historical releases are retained and new supported factories are included", () => {
  const releases = parseReleases(history, { available: false });
  assert.equal(releases.length, history.releases.length);
  const next = structuredClone(history.releases.at(-1).binding);
  next.factory.address = address(999);
  assert.equal(parseReleases(history, { available: true, binding: next }).length, releases.length + 1);
  assert.equal(parseReleases(history, { available: true, binding: history.releases.at(-1).binding }).length, releases.length);
  next.factoryVersion = "v99";
  assert.throws(() => parseReleases(history, { available: true, binding: next }));
});

test("conflicting factory pins cannot override a historical release", () => {
  const next = structuredClone(history.releases[0].binding);
  next.factory.runtimeCodeHash = hash(777);
  assert.throws(() => parseReleases(history, { available: true, binding: next }));
});

function ledgerFixture() {
  const launch = { token: address(11), hook: address(12), ledger: address(13), quote: address(14), creator: address(15),
    poolId: hash(16), release: { factory: { address: address(17) } } };
  const values = [{ token: launch.token, hook: launch.hook, ledger: launch.ledger, poolId: launch.poolId },
    MANAGER, launch.hook, launch.quote, launch.creator, 100n, 25n, 80n, 80n,
    launch.ledger, launch.release.factory.address, launch.token, launch.quote];
  return { launch, values };
}

test("only the factory-bound, backed ledger can supply a claim", () => {
  const { launch, values } = ledgerFixture();
  assert.equal(validateLedger(launch, values).amount, 75n);
  for (const index of [1, 2, 3, 4, 9, 10, 11, 12]) {
    const invalid = [...values]; invalid[index] = address(999);
    assert.throws(() => validateLedger(launch, invalid));
  }
  for (const [index, amount] of [[6, 101n], [7, 74n], [8, 79n]]) {
    const invalid = [...values]; invalid[index] = amount;
    assert.throws(() => validateLedger(launch, invalid));
  }
});

function simulation(amounts, success = true) {
  return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: amounts.map(amount => ({
    success, returnData: encodeFunctionResult({ abi: LEDGER_ABI, functionName: "claimPlatform", result: amount }),
  })) });
}
test("the complete aggregate simulation must pay every expected ledger amount", () => {
  verifySimulation(simulation([12n, 19n]), claims);
  assert.throws(() => verifySimulation(simulation([12n, 18n]), claims));
  assert.throws(() => verifySimulation(simulation([12n]), claims));
  assert.throws(() => verifySimulation(simulation([12n, 19n], false), claims));
});

function receipt(options = {}) {
  return { status: "success", from: account, to: MULTICALL, transactionHash: hash(900), blockHash: hash(901),
    logs: claims.map(claim => ({
      address: claim.ledger,
      topics: encodeEventTopics({ abi: LEDGER_ABI, eventName: "QuoteClaimed", args: { beneficiary: options.recipient ?? TREASURY, budget: options.budget ?? 0 } }),
      data: encodeAbiParameters(parseAbiParameters("uint256"), [options.amount ?? claim.amount]),
    })), ...options };
}
test("receipts require the fixed treasury, platform budget and each ledger", () => {
  const transaction = buildClaimTransaction(account, claims);
  assert.equal(verifyClaimReceipt(receipt(), transaction, claims), true);
  for (const invalid of [receipt({ recipient: account }), receipt({ budget: 1 }), receipt({ status: "reverted" }),
    receipt({ logs: [] }), receipt({ amount: 0n }), receipt({ from: address(101) })])
    assert.throws(() => verifyClaimReceipt(invalid, transaction, claims));
});
test("actual positive payouts may differ from the earlier scan", () => {
  assert.equal(verifyClaimReceipt(receipt({ amount: 1n }), buildClaimTransaction(account, claims), claims), true);
  assert.equal(verifyClaimReceipt(receipt({ amount: 30n }), buildClaimTransaction(account, claims), claims), true);
});
test("a mined failure can be reconciled only against the exact original transaction", async () => {
  const transaction = buildClaimTransaction(account, claims);
  const prepared = { transaction, snapshot: { claims } };
  const mined = { ...transaction, input: transaction.data, value: 0n };
  const reverted = receipt({ status: "reverted", logs: [] });
  const client = { getChainId: async () => CHAIN_ID, getBlock: async () => ({ hash: reverted.blockHash }),
    getTransaction: async () => mined, getTransactionReceipt: async () => reverted };
  assert.equal((await confirmClaim([client, client], hash(900), prepared)).status, "reverted");
  mined.input = "0x";
  await assert.rejects(confirmClaim([client, client], hash(900), prepared));
});
test("chain and deployment pins match the product source", async () => {
  const chainSource = await readFile(new URL("../../lib/chains.ts", import.meta.url), "utf8");
  assert.ok(chainSource.includes(MULTICALL)); assert.ok(chainSource.includes(MULTICALL_HASH));
  const profile = JSON.parse(await readFile(new URL("../../contracts/spec/robinhood-custom-launch/chain-4663.v1.json", import.meta.url), "utf8"));
  assert.equal(profile.contracts.uniswap.poolManager.address, MANAGER);
  assert.equal(profile.contracts.uniswap.poolManager.runtimeCodeHash, MANAGER_HASH);
  assert.equal(CHAIN_ID, 4663);
});
