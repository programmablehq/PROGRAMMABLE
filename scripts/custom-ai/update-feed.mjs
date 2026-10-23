// One bounded feed update. Scheduling belongs to the deployment operator.
// Dry run is the default; --send requires an explicit gas budget and relayer key.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { createPublicClient, createWalletClient, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { confirmFeedUpdate } from "./relay-feed.mjs";

const args = process.argv.slice(2), sending = args.includes("--send"), resuming = args.includes("--resume");
const files = args.filter(value => !value.startsWith("--"));
if (files.length !== 2 || sending && resuming || args.some(value => value.startsWith("--") && !["--send", "--resume"].includes(value))) {
  throw Error("Usage: node scripts/custom-ai/update-feed.mjs config.json journal.json [--send | --resume]");
}
const config = JSON.parse(await readFile(files[0], "utf8"));
if (![1, 4663].includes(config.chainId)) throw Error("Unsupported feed network");
const transport = http(config.rpcUrl, { retryCount: 0, timeout: 20_000 });
const client = createPublicClient({ transport });
if (await client.getChainId() !== config.chainId) throw Error("Incorrect relayer network");
let journal;
if (resuming) {
  journal = JSON.parse(await readFile(files[1], "utf8"));
  if (journal.chainId !== config.chainId || !journal.rawTransaction || keccak256(journal.rawTransaction) !== journal.transactionHash) throw Error("Invalid saved transaction");
} else {
  const root = resolve(import.meta.dirname, "../..");
  const built = await build({ absWorkingDir: root, stdin: { contents: "export { prepareFeedUpdate } from './lib/custom-ai/feed-update.server';", resolveDir: root },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "operator", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "empty" }));
      b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" }));
    } }] });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const update = await loaded.exports.prepareFeedUpdate({ rule: config.rule, chainId: config.chainId, adapter: config.adapter,
    signingKey: process.env.CUSTOM_AI_DATA_SIGNER_KEY });
  journal = { version: 1, status: "prepared", ...update };
  if (sending) {
    if (!/^\d+$/.test(config.maximumGasCostWei ?? "") || BigInt(config.maximumGasCostWei) <= 0n) throw Error("Set an explicit maximumGasCostWei");
    const account = privateKeyToAccount(process.env.CUSTOM_AI_RELAYER_KEY);
    const wallet = createWalletClient({ account, transport });
    const gasPrice = await client.getGasPrice();
    const estimated = await client.estimateGas({ account, to: update.transaction.to, data: update.transaction.data, value: 0n });
    const gas = estimated * 12n / 10n;
    if (gas > 200_000n || gas * gasPrice > BigInt(config.maximumGasCostWei)) throw Error("Feed update exceeds its gas budget");
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    const rawTransaction = await wallet.signTransaction({ account, chain: null, chainId: config.chainId, type: "legacy", nonce, gas, gasPrice,
      to: update.transaction.to, data: update.transaction.data, value: 0n });
    journal = { ...journal, rawTransaction, transactionHash: keccak256(rawTransaction), maximumGasCostWei: (gas * gasPrice).toString() };
  }
  // Reserve the exact signed transaction before broadcasting. Never overwrite an uncertain attempt.
  await writeFile(files[1], JSON.stringify(journal, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
if (sending || resuming) {
  const receipt = await confirmFeedUpdate(client, journal);
  journal.status = receipt.status === "success" ? "confirmed" : "reverted";
  journal.blockNumber = receipt.blockNumber.toString(); journal.blockHash = receipt.blockHash;
  await writeFile(files[1], JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
}
console.log(JSON.stringify({ status: journal.status, chainId: journal.chainId, sequence: journal.sequence, transactionHash: journal.transactionHash ?? null }));
