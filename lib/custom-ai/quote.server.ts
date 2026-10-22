import "server-only";
import { createHash } from "node:crypto";
import { encodeFunctionData, keccak256, parseAbi, toHex, type Abi, type Address } from "viem";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { bytesV1, objectV1, quantityV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { customAIChain, type CustomAIChain } from "./chain.server";
import runtimeReviews from "./quote-runtime-reviews.json";

export type QuoteCheck = {
  status: "compatible" | "unresolved";
  chainId: 1 | 4663; address: Address; runtimeHash: string; decimals: number;
  blockNumber: string; blockHash: string; checkedAt: number;
  controlCheck: "verified-wrapped-native-runtime" | "verified-proxy-runtime" | "external-rights-unverified" | "unresolved";
  transferCheck: "passed" | "unresolved";
  evidenceHash: string;
  controls?: { implementation: Address; implementationHash: string; administrator: Address; gateway: Address;
    upgradeable: true; bridgeCanBurn: true };
  message?: string;
};
const abi: Abi = parseAbi([
  "function deposit() payable", "function withdraw(uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
  "function transferFrom(address from,address to,uint256 amount) returns (bool)",
]);
const digest = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");

// Recognize complete reviewed runtimes, including the current implementation of
// a proxy. Compatibility describes the observed transfer behavior; external
// upgrade/bridge rights remain visible. Unknown code stays unresolved.
export async function inspectCustomAIQuote(chainId: 1 | 4663, address: Address,
  supplied?: CustomAIChain, holder?: Address): Promise<QuoteCheck> {
  const chain = supplied ?? await customAIChain(chainId);
  if (chain.chainId !== chainId) throw Error("The quote reader belongs to another network.");
  const [code, decimals] = await Promise.all([chain.code(address), chain.call(address, "function decimals() view returns (uint8)")]);
  if (code === "0x" || typeof decimals !== "number" || decimals < 0 || decimals > 36) throw Error("Unsupported quote contract.");
  const runtimeHash = keccak256(code);
  const known = foundationChainProfile(1).wrappedEth.runtimeCodeHash === runtimeHash && runtimeReviews.weth9.runtimeHash === runtimeHash;
  const upgradeable = foundationChainProfile(4663).wrappedEth.runtimeCodeHash === runtimeHash;
  const base = { chainId, address, runtimeHash, decimals, blockNumber: chain.block.number,
    blockHash: chain.block.hash, checkedAt: Math.floor(Date.now() / 1000) };
  let transferCheck: QuoteCheck["transferCheck"] = "unresolved";
  let message = upgradeable ? "This quote uses an upgradeable proxy. Its implementation and control rights still need to be checked."
    : "This quote token's transfer controls have not been verified yet.";
  let execution: unknown;
  let controls: QuoteCheck["controls"];
  if (upgradeable) {
    const slotAddress = async (slot: string) => {
      const value = await chain.agreed("eth_getStorageAt", [address, slot, chain.reference], bytesV1);
      if (value.length !== 66) throw Error("Invalid proxy storage response.");
      return `0x${value.slice(-40)}` as Address;
    };
    const [implementation, administrator] = await Promise.all([
      slotAddress("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"),
      slotAddress("0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"),
    ]);
    const implementationHash = keccak256(await chain.code(implementation));
    if (runtimeHash === runtimeReviews.transparentProxy.runtimeHash && implementationHash === runtimeReviews.aeWETH.runtimeHash) {
      const gateway = await chain.call(address, "function l2Gateway() view returns (address)");
      if (typeof gateway !== "string" || !/^0x[0-9a-f]{40}$/i.test(gateway)) throw Error("The bridge gateway could not be read.");
      controls = { implementation, implementationHash, administrator, gateway: gateway as Address, upgradeable: true, bridgeCanBurn: true };
      message = "The quote token is upgradeable. Its bridge can burn balances.";
    }
  }
  if ((known || controls) && decimals === 18) {
    try { execution = await checkWrappedNativeTransfers(chain, address); transferCheck = "passed"; message = ""; }
    catch { message = "The quote transfer check could not finish on both providers. Try again shortly."; }
  }
  if (!known && !upgradeable) {
    try { execution = await checkERC20Transfers(chain, address, decimals, holder); transferCheck = "passed";
      message = "This pair token's transfers passed the current check. Its admin rights are unverified; it may allow freezes, upgrades or balance changes.";
    } catch { message = "The pair token's transfers could not be verified. Connect a wallet holding the initial-buy amount and try again."; }
  }
  if (controls && transferCheck === "passed") message = "The pair token is upgradeable, and its bridge can burn balances. These rights belong to the pair token; your new coin has neither.";
  await chain.finish();
  const result = { ...base, status: transferCheck === "passed" ? "compatible" as const : "unresolved" as const,
    controlCheck: known ? "verified-wrapped-native-runtime" as const : controls ? "verified-proxy-runtime" as const : transferCheck === "passed" ? "external-rights-unverified" as const : "unresolved" as const,
    transferCheck, ...(controls ? { controls } : {}), ...(message ? { message } : {}) };
  return { ...result, evidenceHash: digest({ ...result, execution }) };
}

/** Exercise real quote code/state on both RPCs. Only isolated probe accounts get
 * synthetic native gas/deposit funds. No token balances or allowances are forged. */
export async function checkWrappedNativeTransfers(chain: CustomAIChain, quote: Address) {
  const a = `0x${digest([chain.chainId, quote, chain.block.hash, "a"]).slice(-40)}` as Address;
  const b = `0x${digest([chain.chainId, quote, chain.block.hash, "b"]).slice(-40)}` as Address;
  const zero = await Promise.all([chain.code(a), chain.code(b), chain.call(quote, "function balanceOf(address) view returns (uint256)", [a]),
    chain.call(quote, "function balanceOf(address) view returns (uint256)", [b])]);
  if (zero[0] !== "0x" || zero[1] !== "0x" || zero[2] !== 0n || zero[3] !== 0n) throw Error("Probe accounts are not empty.");
  const amount = 1_000_000_000_000_000n;
  const call = (functionName: string, args: readonly unknown[] = [], from = a, value = 0n) => ({
    from, to: quote, data: encodeFunctionData({ abi, functionName, args }), gas: "0x493e0", value: toHex(value) });
  const calls = [call("deposit", [], a, amount), call("balanceOf", [a]), call("approve", [b, amount]),
    call("allowance", [a, b]), call("transferFrom", [a, b, amount / 2n], b), call("balanceOf", [a]), call("balanceOf", [b]),
    call("transfer", [a, amount / 2n], b), call("balanceOf", [a]), call("balanceOf", [b]),
    call("withdraw", [amount]), call("balanceOf", [a]), call("allowance", [a, b])];
  const result = await chain.agreed("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: {
    [a]: { balance: toHex(10n ** 18n) }, [b]: { balance: toHex(10n ** 18n) },
  }, calls }], validation: false, traceTransfers: false }, toHex(BigInt(chain.block.number))], value => {
    if (!Array.isArray(value) || value.length !== 1) throw Error("Incomplete quote simulation.");
    const results = objectV1(value[0]).calls;
    if (!Array.isArray(results) || results.length !== calls.length) throw Error("Incomplete quote simulation.");
    return results.map(result => {
      const item = objectV1(result);
      if (quantityV1(item.status) !== 1n || item.error) throw Error("Quote simulation reverted.");
      return bytesV1(item.returnData);
    });
  });
  for (const [index, expected] of [[1, amount], [3, amount], [5, amount / 2n], [6, amount / 2n],
    [8, amount], [9, 0n], [11, 0n], [12, amount / 2n]] as const) {
    if (result[index].length !== 66 || BigInt(result[index]) !== expected) throw Error("Quote balance or allowance changed unexpectedly.");
  }
  for (const index of [2, 4, 7]) if (result[index] !== "0x" && (result[index].length !== 66 || BigInt(result[index]) !== 1n)) throw Error("Quote rejected a transfer.");
  return { calls: calls.length, outputs: result, blockHash: chain.block.hash };
}

/** Observe exact ERC20 transfers using existing holder balances. Simulation may
 * impersonate a holder, but never forges token state, code or allowances. The
 * actual launch/trade is simulated separately from the authenticated wallet.
 * Passing this probe is not evidence about ownership or future admin actions. */
export async function checkERC20Transfers(chain: CustomAIChain, quote: Address, decimals: number, holder?: Address) {
  const holders = [...new Set([holder, chain.profile.infrastructure.poolManager.address].filter((value): value is Address => !!value))];
  let source: Address | undefined, available = 0n;
  for (const candidate of holders) {
    const balance = await chain.call(quote, "function balanceOf(address) view returns (uint256)", [candidate]) as bigint;
    if (balance >= 16n) { source = candidate; available = balance; break; }
  }
  if (!source) throw Error("No funded simulation holder");
  const cap = 10n ** BigInt(Math.min(decimals,18));
  const amount = available / 16n < cap ? available / 16n : cap;
  const half = amount / 2n;
  if (!half) throw Error("Insufficient probe amount");
  const a = `0x${digest([chain.chainId,quote,chain.block.hash,"erc20-a"]).slice(-40)}` as Address;
  const b = `0x${digest([chain.chainId,quote,chain.block.hash,"erc20-b"]).slice(-40)}` as Address;
  for (const probe of [a,b]) if (await chain.code(probe) !== "0x" || await chain.call(quote,"function balanceOf(address) view returns (uint256)",[probe]) !== 0n) throw Error("Probe account is not empty");
  const call = (functionName:string,args:readonly unknown[],from=a) => ({from,to:quote,data:encodeFunctionData({abi,functionName,args}),gas:"0x7a120",value:"0x0"});
  const calls = [call("transfer",[a,amount],source),call("balanceOf",[source]),call("balanceOf",[a]),
    call("approve",[b,amount]),call("allowance",[a,b]),call("transferFrom",[a,b,half],b),
    call("balanceOf",[a]),call("balanceOf",[b]),call("allowance",[a,b]),call("transfer",[a,half],b),
    call("balanceOf",[a]),call("balanceOf",[b]),call("approve",[b,0n]),call("allowance",[a,b]),
    call("transfer",[source,amount]),call("balanceOf",[a]),call("balanceOf",[source])];
  const outputs = await chain.agreed("eth_simulateV1",[{blockStateCalls:[{stateOverrides:{[a]:{balance:toHex(10n**18n)},[b]:{balance:toHex(10n**18n)}},calls}],validation:false,traceTransfers:false},toHex(BigInt(chain.block.number))],value=> {
    if (!Array.isArray(value) || value.length !== 1) throw Error("Missing transfer simulation");
    const result = objectV1(value[0]).calls;
    if (!Array.isArray(result) || result.length !== calls.length) throw Error("Incomplete transfer simulation");
    return result.map(item=> { const row=objectV1(item); if (row.error || quantityV1(row.status) !== 1n) throw Error("Transfer reverted"); return bytesV1(row.returnData); });
  });
  for (const [index,expected] of [[1,available-amount],[2,amount],[4,amount],[6,amount-half],[7,half],[8,amount-half],[10,amount],[11,0n],[13,0n],[15,0n],[16,available]] as const) {
    if (outputs[index].length !== 66 || BigInt(outputs[index]) !== expected) throw Error("Inexact ERC20 transfer or allowance");
  }
  for (const index of [0,3,5,9,12,14]) if (outputs[index] !== "0x" && (outputs[index].length !== 66 || BigInt(outputs[index]) !== 1n)) throw Error("ERC20 rejected transfer");
  return {policy:"existing-balances-exact-transfers-v1",source,amount:amount.toString(),blockHash:chain.block.hash,outputs};
}
