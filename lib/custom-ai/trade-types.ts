import type { Address, Hex } from "viem";
import type { WalletSession } from "./launch-session";

export type AITradeIntent = "program-execute" | "program-stake" | "program-withdraw" | "program-claim" | "buy" | "sell" | "claim-creator" | "claim-platform" | "claim-reward";
export type AITradeQuote = { input:Address; output:Address; amount:string; expected:string; minimum:string;
  inputDecimals:number; outputDecimals:number; platform:string; additional:string; expiresAt:number; blockHash:Hex };
export type AITradeSession = WalletSession & { token:Address; intent:AITradeIntent; amount:string; slippageBps:number; inputHash:string;
  quote?:AITradeQuote; settlement?: { paid:string; received:string; platform:string; additional:string; blockNumber:string; blockHash:Hex };
  claimSettlement?: {recipient:Address;amount:string;blockNumber:string;blockHash:Hex}; };
export type StoredAITrade = { revision:number;session:AITradeSession };
