import { decodeEventLog, parseAbi, type Address, type Hex } from "viem";
import type { CustomAIPublicToken } from "./public-types";
import type { AITradeSession } from "./trade-types";

export const transferABI = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
export const aiSwapEventABI = parseAbi(["event CustomAISwap(bytes32 indexed poolId,address indexed router,bool buy,bool exactInput,uint256 grossQuote,uint256 platformQuote,uint256 additionalQuote,uint16 additionalBps,uint8 moduleStatus)"]);
export type AIReceiptLog = {address:Address;data:Hex;topics:[Hex,...Hex[]]};
const claimABI = parseAbi(["event FeesClaimed(address indexed recipient,bool indexed platform,uint256 amount)"]);
const vaultABI = parseAbi(["event Claimed(address indexed beneficiary,bool creator,uint256 amount)"]);
const treasury = "0xD88539d3c4C460136a733A3Fd60cf6BF269079da";
export const aiRouterSettlementABI = parseAbi(["event SwapSettled(address indexed payer,address indexed recipient,address indexed input,address output,uint256 paid,uint256 received)"]);
export function readSwapFees(logs:AIReceiptLog[],token:CustomAIPublicToken,router:Address,buy:boolean) {
  const swaps = logs.filter(log=>log.address.toLowerCase()===token.hookAddress.toLowerCase()).flatMap(log=> {
    try { return [decodeEventLog({abi:aiSwapEventABI,...log}).args]; } catch { return []; }
  });
  if (swaps.length !== 1) throw Error("Missing Custom AI swap settlement");
  const swap = swaps[0];
  if (swap.poolId !== token.poolId || swap.router.toLowerCase() !== router.toLowerCase() || swap.buy !== buy || !swap.exactInput
    || swap.additionalBps>1450 || swap.platformQuote !== swap.grossQuote*50n/10000n
    || swap.additionalQuote !== swap.grossQuote*BigInt(50+swap.additionalBps)/10000n-swap.platformQuote) throw Error("Custom AI fee settlement mismatch");
  return swap;
}
export function verifyAISwapSettlement(logs:AIReceiptLog[],session:AITradeSession,token:CustomAIPublicToken,router:Address) {
  const quote=session.quote;
  if (!quote) throw Error("Missing saved trade quote");
  const settled = logs.filter(log => log.address.toLowerCase() === router.toLowerCase()).flatMap(log => {
    try { return [decodeEventLog({abi:aiRouterSettlementABI,...log}).args]; } catch { return []; }
  });
  if (settled.length !== 1) throw Error("Missing Custom AI router settlement");
  const {payer,recipient,input,output,paid,received} = settled[0];
  if ([payer,recipient].some(value => value.toLowerCase() !== session.account.toLowerCase())
    || input.toLowerCase() !== quote.input.toLowerCase() || output.toLowerCase() !== quote.output.toLowerCase()) throw Error("Custom AI transfer settlement mismatch");
  const fees=readSwapFees(logs,token,router,session.intent==="buy");
  if (paid !== BigInt(quote.amount) || received<BigInt(quote.minimum) || received===0n
    || session.intent==="buy" && paid!==fees.grossQuote
    || session.intent==="sell" && received!==fees.grossQuote-fees.platformQuote-fees.additionalQuote) throw Error("Custom AI transfer settlement mismatch");
  return {paid:paid.toString(),received:received.toString(),platform:fees.platformQuote.toString(),additional:fees.additionalQuote.toString()};
}

export function verifyAIClaimSettlement(logs:AIReceiptLog[],kind:string,token:CustomAIPublicToken,account:Address,creator:Address) {
  const ledger = kind === "collect-fees" || kind === "claim-platform";
  const source = ledger ? token.ledger : token.rewardVault;
  const recipient = kind === "collect-fees" ? token.rewardVault : kind === "claim-platform" ? treasury : kind === "claim-creator" ? creator : account;
  const matches = logs.filter(log => log.address.toLowerCase() === source.toLowerCase()).flatMap(log => {
    try {
      if (ledger) {
        const {args}=decodeEventLog({abi:claimABI,...log});
        return args.recipient.toLowerCase() === recipient.toLowerCase() && args.platform === (kind === "claim-platform") ? [args.amount] : [];
      }
      const {args}=decodeEventLog({abi:vaultABI,...log});
      return args.beneficiary.toLowerCase() === recipient.toLowerCase() && args.creator === (kind === "claim-creator") ? [args.amount] : [];
    } catch { return []; }
  });
  // The verified core emits this event only after checking exact sender/recipient balances.
  if (matches.length !== 1 || matches[0] <= 0n) {
    throw Error("Custom AI claim settlement mismatch");
  }
  return {recipient,amount:matches[0].toString()};
}
