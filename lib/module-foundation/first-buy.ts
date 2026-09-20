import { formatUnits, parseAbi, type PublicClient } from "viem";

// The same Robinhood ETH/USD feed used by the launch price service.
const ETH_USD_FEED = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9";
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
]);

/** An editable suggestion worth about $3.50, never an execution quote or spending authorization. */
export async function readFoundationSuggestedBuy(client: PublicClient): Promise<string> {
  const [[roundId, answer, , updatedAt, answeredInRound], decimals] = await Promise.all([
    client.readContract({ address: ETH_USD_FEED, abi: feedAbi, functionName: "latestRoundData" }),
    client.readContract({ address: ETH_USD_FEED, abi: feedAbi, functionName: "decimals" }),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (roundId <= 0n || answer <= 0n || answeredInRound < roundId || updatedAt <= 0n || updatedAt > now
    || now - updatedAt > 86_400n || decimals > 36) throw new Error("A current ETH price is unavailable.");
  const microEth = (3_500_000n * 10n ** BigInt(decimals) + answer / 2n) / answer;
  if (microEth <= 0n) throw new Error("A current ETH amount is unavailable.");
  return formatUnits(microEth, 6);
}
