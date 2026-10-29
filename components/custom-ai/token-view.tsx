"use client";
import { RobinhoodMarketView } from "@/components/robinhood-market-view";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import type { CustomAIPublicToken } from "@/lib/custom-ai/public-types";
import { CustomAITradePanel } from "./trade-panel";
import { OperationStatus } from "./operation-status";

export function CustomAITokenView({token,market}:{token:CustomAIPublicToken;market:RobinhoodCoinMarket|null}) {
  return <RobinhoodMarketView chainId={token.chainId} address={token.tokenAddress} name={token.name} symbol={token.symbol}
    launch={{tokenAddress:token.tokenAddress,poolId:token.poolId,quoteAsset:token.quoteAsset}}
    presentation={{chainId:token.chainId,tokenAddress:token.tokenAddress,imageUrl:token.imageUrl,description:token.description,links:[],market}}
    trade={<><OperationStatus key={`${token.chainId}:${token.tokenAddress}`} chainId={token.chainId} token={token.tokenAddress}/><CustomAITradePanel token={token}/></>}/>;
}
