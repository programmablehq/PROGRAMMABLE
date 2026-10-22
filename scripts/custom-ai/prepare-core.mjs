import { readFile, writeFile, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { encodeDeployData, getAddress, getCreateAddress, keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// This operator only prepares simulations. It never signs a transaction or
// submits eth_sendRawTransaction. Inputs and outputs are outside the checkout.
const root = resolve(import.meta.dirname, "../..");
const [rpcFile, signerFile, outputDirectory, accountInput] = process.argv.slice(2);
if (!rpcFile || !signerFile || !outputDirectory || !accountInput) throw Error("Expected RPC file, signer file, output directory and deployment account.");
const rpcStat = await lstat(rpcFile);
if (!rpcStat.isFile() || rpcStat.isSymbolicLink() || rpcStat.mode & 0o077) throw Error("The RPC file must be private.");
const environment = JSON.parse(await readFile(rpcFile, "utf8"));
for (const [key,value] of Object.entries(environment)) {
  if (!/^(PROGRAMMABLE_WEBSITE_MAINNET_RPC_(PRIMARY|SECONDARY)_(PROVIDER|URL|ENDPOINT_COMMITMENT)|ROBINHOOD_V4_RPC_(PRIMARY|SECONDARY)_URL)$/.test(key)
    || typeof value !== "string") throw Error("Unexpected RPC binding.");
  process.env[key] = value;
}
let signerKey;
try { signerKey = (JSON.parse(await readFile(signerFile, "utf8"))).privateKey; }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  signerKey = generatePrivateKey();
  await writeFile(signerFile, JSON.stringify({ privateKey: signerKey, purpose: "Custom AI immutable launch price signer" })+"\n", { flag: "wx", mode: 0o600 });
}
if ((await lstat(signerFile)).mode & 0o077) throw Error("The signer file must be private.");
const signer = privateKeyToAccount(signerKey).address;
const account = getAddress(accountInput);
const compiled = await build({ absWorkingDir: root, stdin: { contents: "export { customAIChain } from './lib/custom-ai/chain.server';", resolveDir: root },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "server-operator", setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" })); } }] });
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const bundle = JSON.parse(await readFile(resolve(root,"scripts/custom-ai/core-bundle.json"), "utf8"));
for (const chainId of [1,4663]) {
  try {
    const chain = await loaded.exports.customAIChain(chainId);
    const [latest,pending,balance,gasPrice] = await Promise.all([
      chain.agreed("eth_getTransactionCount", [account,"latest"], x => BigInt(x).toString()),
      chain.agreed("eth_getTransactionCount", [account,"pending"], x => BigInt(x).toString()),
      chain.agreed("eth_getBalance", [account,chain.reference], x => BigInt(x).toString()),
      Promise.all(chain.rpcs.map(rpc => rpc("eth_gasPrice", []).then(BigInt))).then(x => x.reduce((a,b)=>a>b?a:b)),
    ]);
    if (latest !== pending) throw Error("Deployment account has pending transactions.");
    const nonce = BigInt(pending), manager = chain.profile.infrastructure.poolManager.address;
    if (keccak256(await chain.code(manager)) !== chain.profile.infrastructure.poolManager.runtimeCodeHash) throw Error("PoolManager runtime differs.");
    const contracts = ["CustomAIHookDeployerV1","CustomAILiquidityDeployerV1","CustomAISwapRouterV1","CustomAIFactoryV1"];
    const addresses = contracts.map((_,i) => getCreateAddress({ from: account, nonce: nonce + BigInt(i) }));
    const args = [[],[],[manager],[manager,addresses[0],addresses[1],addresses[2],signer]];
    const calls = contracts.map((name,i) => ({ from: account, data: encodeDeployData({ abi: bundle.contracts[name].abi, bytecode: bundle.contracts[name].initCode, args: args[i] }),
      nonce: toHex(nonce+BigInt(i)), value: "0x0", gas: toHex(30_000_000n) }));
    const simulated = await chain.agreed("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: { [account]: { balance: toHex(10n**20n) } }, calls }], validation: false }, toHex(BigInt(chain.block.number))], result => {
      if (!Array.isArray(result) || result.length !== 1 || result[0].calls?.length !== 4) throw Error("Incomplete deployment simulation.");
      return result[0].calls.map(call => {
        if (BigInt(call.status) !== 1n || call.error) throw Error("Deployment simulation reverted.");
        return { gasUsed: BigInt(call.gasUsed).toString(), runtime: call.returnData };
      });
    });
    await chain.finish();
    const steps = calls.map((call,i) => ({ contract: contracts[i], address: addresses[i], transaction: call,
      runtimeHash: keccak256(simulated[i].runtime), gasLimit: (BigInt(simulated[i].gasUsed)*12n/10n+10_000n).toString() }));
    const totalGas = steps.reduce((sum,step)=>sum+BigInt(step.gasLimit),0n);
    const plan = { version: 1, mode: "simulation-only", createdAt: new Date().toISOString(), chainId, account, signer,
      coreBundleHash: bundle.bundleHash, checkpoint: chain.block, accountBalanceWei: balance, gasPriceWei: gasPrice.toString(),
      totalGasLimit: totalGas.toString(), estimatedDeploymentWei: (totalGas*gasPrice).toString(), steps };
    await writeFile(resolve(outputDirectory,`${chainId}.json`),JSON.stringify(plan,null,2)+"\n",{flag:"wx"});
    console.log(JSON.stringify({chainId,status:"prepared",accountBalanceWei:balance,totalGasLimit:plan.totalGasLimit,estimatedDeploymentWei:plan.estimatedDeploymentWei}));
  } catch (error) { console.log(JSON.stringify({ chainId, status: "blocked", error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g,"[provider]") : "Preparation failed" })); }
}
