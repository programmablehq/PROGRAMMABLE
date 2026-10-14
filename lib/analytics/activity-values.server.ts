import "server-only";
import { unstable_cache } from "next/cache";
import { codexQuery } from "@/lib/server/codex-market";
import { decodeActivityValues, type PriceRequest } from "./activity-values";

export const readActivityValues = unstable_cache(async (requests: PriceRequest[]) => {
  if (!requests.length || requests.length > 10) return {};
  const query = `query ActivityPrices { ${requests.map((r,i)=>`p${i}: getTokenPrices(inputs:[{address:"${r.address}",networkId:${r.networkId},timestamp:${r.timestamp}}]) { address networkId timestamp priceUsd }`).join(" ")} }`;
  return decodeActivityValues(requests,await codexQuery(query,{}));
}, ["analytics-historical-activity-usd-v1"], { revalidate:86400, tags:["programmable-analytics"] });
