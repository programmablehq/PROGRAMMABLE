import "server-only";
import { unstable_cache } from "next/cache";
import { codexQuery } from "@/lib/server/codex-market";
import { decodeActivityValues, type PriceRequest } from "./activity-values";

export const readActivityValues = unstable_cache(async (requests: PriceRequest[]) => {
  if (!requests.length || requests.length > 10) return {};
  const direct = decodeActivityValues(requests.filter(r=>r.units === 0),{});
  const priced = requests.filter(r=>r.units > 0);
  if (!priced.length) return direct;
  const query = `query ActivityPrices { ${priced.map((r,i)=>`p${i}: getTokenPrices(inputs:[{address:"${r.address}",networkId:${r.networkId},timestamp:${r.timestamp}}]) { address networkId timestamp priceUsd }`).join(" ")} }`;
  return { ...direct, ...decodeActivityValues(priced,await codexQuery(query,{})) };
}, ["analytics-historical-activity-usd-v1"], { revalidate:86400, tags:["programmable-analytics"] });
