import { activityKey, number, summarize, type Activity, type ActivityValue, type AnalyticsData } from "./model";

export type PriceRequest = { activity: Activity; address: string; networkId: number; timestamp: number; units: number; otherUsd: number };
const current = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";
const legacy = "0x7987f03462200b3d8a072e02c89a8a41dcb124ee";
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

export function activityPriceRequests(data: AnalyticsData): PriceRequest[] {
  const audit = new Map<string, { amount: number | null; spent: number | null; otherUsd: number | null }>();
  const raw = data.buybacks.rows[0]?.transaction_audit;
  if (typeof raw === "string") for (const entry of raw.split(";")) {
    const [chain,hash,amount,spent,otherUsd] = entry.split("|");
    if ((chain === "1" || chain === "4663") && /^[a-f\d]{64}$/i.test(hash)) audit.set(`${chain}:0x${hash.toLowerCase()}`, { amount:number(amount),spent:number(spent),otherUsd:number(otherUsd) });
  }
  return summarize(data,"all","all").activity.slice(0,10).flatMap(activity => {
    const timestamp = Math.floor(Date.parse(activity.at)/1000);
    if (activity.kind === "Burn") return [{ activity, timestamp, address:activity.chain === "Robinhood" ? current : legacy, networkId:activity.chain === "Robinhood" ? 4663 : 1, units:activity.amount, otherUsd:0 }];
    if (number(data.buybacks.rows[0]?.unpriced_buybacks) !== 0) return [];
    const cost = audit.get(`${activity.chain === "Robinhood" ? 4663 : 1}:${activity.hash}`);
    if (!cost || cost.amount !== activity.amount || cost.spent === null || cost.otherUsd === null) return [];
    // Native ETH and WETH costs use historical ETH prices, not the value of V4 received.
    return [{ activity, timestamp, address:weth, networkId:1, units:cost.spent, otherUsd:cost.otherUsd }];
  });
}

export function decodeActivityValues(requests: PriceRequest[], data: Record<string, unknown>): Record<string,ActivityValue> {
  const values: Record<string,ActivityValue> = {};
  requests.forEach((request,i) => {
    const rows = data[`p${i}`];
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    const price = number(row?.priceUsd), timestamp = number(row?.timestamp);
    // Never substitute today's price, another asset or a stale/future quote.
    if (request.units > 0 && (row?.address?.toLowerCase() !== request.address || row.networkId !== request.networkId || price === null || price <= 0 || timestamp === null || timestamp > request.timestamp || request.timestamp-timestamp > 86400)) return;
    const usd = request.units*(price ?? 0)+request.otherUsd;
    if (Number.isFinite(usd) && usd > 0) values[activityKey(request.activity)] = { usd,amount:request.activity.amount,at:request.activity.at };
  });
  return values;
}
