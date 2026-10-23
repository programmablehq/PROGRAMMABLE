import "server-only";
import { encodeFunctionData, keccak256, parseAbi, type Address } from "viem";
import type { CustomAIChain } from "./chain.server";
import type { CustomAIPublicToken } from "./public-types";
import { programArtifact } from "./program.server";
import { matchesRuntime } from "./runtime";
import { CustomAIError } from "./types";
import { makeStep } from "./transaction.server";
import { initialBuyRaw } from "./preview";
import type { AITradeSession } from "./trade-types";

const abi = parseAbi(["function collect()", "function distribute() returns (uint256)", "function buyback() returns (uint256,uint256)",
  "function stake(uint256)", "function withdraw(uint256)", "function claim() returns (uint256)",
  "function approve(address,uint256) returns (bool)"]);

export async function readProgram(chain: CustomAIChain, token: CustomAIPublicToken, factory: Address, account?: Address) {
  const address = await chain.call(token.rewardVault, "function rewardModule() view returns (address)") as Address;
  if (BigInt(address) === 0n) return null;
  const code = await chain.code(address);
  if (!matchesRuntime(code, programArtifact)) return null;
  const hash = await chain.call(token.rewardVault, "function moduleCodeHash() view returns (bytes32)");
  const bound = await Promise.all([chain.call(address, "function factory() view returns (address)"),
    chain.call(address, "function creator() view returns (address)"), chain.call(address, "function launchSalt() view returns (bytes32)"),
    chain.call(address, "function quote() view returns (address)")]);
  if (hash !== keccak256(code) || [factory, token.creator, token.launchSalt, token.quoteAsset]
    .some((expected, index) => expected.toLowerCase() !== String(bound[index]).toLowerCase())) throw new CustomAIError("program", "The reward program binding could not be verified.", 409);
  const read = (signature: string, args: unknown[] = []) => chain.call(address, signature, args);
  const [mode, interval, nextExecution, totalStaked, recipient, maximumBatch, minimumTokensPerQuote, share, stake, debt, earned, perToken] = await Promise.all([
    read("function mode() view returns (uint8)"), read("function interval() view returns (uint64)"),
    read("function nextExecution() view returns (uint256)"), read("function totalStaked() view returns (uint256)"),
    read("function recipient() view returns (address)"), read("function maximumBatch() view returns (uint128)"),
    read("function minimumTokensPerQuote() view returns (uint256)"), chain.call(token.rewardVault, "function creatorShareBps() view returns (uint16)"),
    account ? read("function staked(address) view returns (uint256)", [account]) : 0n,
    account ? read("function rewardPerTokenPaid(address) view returns (uint256)", [account]) : 0n,
    account ? read("function earned(address) view returns (uint256)", [account]) : 0n,
    read("function rewardPerToken() view returns (uint256)"),
  ]);
  const claimable = BigInt(String(earned)) + BigInt(String(stake)) * (BigInt(String(perToken)) - BigInt(String(debt))) / 10n ** 27n;
  return { address, kind: (["distribution", "staking", "buyback"] as const)[Number(mode)], interval: String(interval), nextExecution: String(nextExecution),
    totalStaked: String(totalStaked), recipient: String(recipient), maximumBatch: String(maximumBatch), minimumTokensPerQuote: String(minimumTokensPerQuote),
    rewardShareBps: 10000 - Number(share), staked: String(stake), claimable: claimable.toString() };
}

export async function prepareProgramAction(chain: CustomAIChain, session: AITradeSession,
  market: { token: CustomAIPublicToken; deployment: { factory: { address: Address } } }) {
  const program = await readProgram(chain, market.token, market.deployment.factory.address, session.account);
  if (!program) throw new CustomAIError("program", "This coin has no supported reward program.", 422);
  const amount = BigInt(initialBuyRaw(session.amount, 18));
  let data: `0x${string}`;
  if (session.intent === "program-stake" || session.intent === "program-withdraw") {
    if (program.kind !== "staking" || amount === 0n) throw new CustomAIError("amount", "Enter a staking amount.");
    if (session.intent === "program-stake") {
      const allowance = await chain.call(session.token, "function allowance(address,address) view returns (uint256)", [session.account, program.address]) as bigint;
      if (allowance < amount) return makeStep(chain, session, allowance ? "reset-approval" : "approve", session.token,
        encodeFunctionData({ abi, functionName: "approve", args: [program.address, allowance ? 0n : amount] }));
    }
    data = encodeFunctionData({ abi, functionName: session.intent === "program-stake" ? "stake" : "withdraw", args: [amount] });
  } else if (session.intent === "program-claim") {
    if (program.kind !== "staking") throw new CustomAIError("program", "This program does not use staking rewards.");
    data = encodeFunctionData({ abi, functionName: "claim" });
  } else {
    if (!session.steps.some(step => step.kind === "collect-fees" && step.state === "confirmed")) {
      const received = await chain.call(market.token.ledger, "function additionalReceived() view returns (uint256)") as bigint;
      const claimed = await chain.call(market.token.ledger, "function additionalClaimed() view returns (uint256)") as bigint;
      if (received > claimed) return makeStep(chain, session, "collect-fees", market.token.ledger,
        encodeFunctionData({ abi: parseAbi(["function claimAdditional() returns (uint256)"]), functionName: "claimAdditional" }));
    }
    data = encodeFunctionData({ abi, functionName: program.kind === "staking" ? "collect" : program.kind === "buyback" ? "buyback" : "distribute" });
  }
  return makeStep(chain, session, "program-action", program.address, data);
}
