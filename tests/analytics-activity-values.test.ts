import { describe, expect, it } from "vitest";
import { decodeActivityValues, type PriceRequest } from "@/lib/analytics/activity-values";
import { activityKey, summarize, type AnalyticsData } from "@/lib/analytics/model";
import snapshot from "@/lib/analytics/snapshot.json";

const activity = { kind:"Buyback" as const,chain:"Robinhood" as const,hash:`0x${"1".repeat(64)}`,amount:500,at:"2026-10-10T18:00:00.000Z" };
const request: PriceRequest = { activity,address:"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",networkId:1,timestamp:1791655200,units:2,otherUsd:10 };
const price = { address:request.address,networkId:1,timestamp:request.timestamp-10,priceUsd:2500 };
describe("historical activity valuation",()=>{
  it("values actual input costs and keeps them separate from the V4 received",()=>{
    expect(decodeActivityValues([request],{p0:[price]})[activityKey(activity)].usd).toBe(5010);
  });
  it("does not accept future, stale, wrong-chain or wrong-token quotes",()=>{
    for(const invalid of [{...price,timestamp:request.timestamp+1},{...price,timestamp:request.timestamp-86401},{...price,networkId:4663},{...price,address:"0x0000000000000000000000000000000000000001"},{...price,priceUsd:0}]) expect(decodeActivityValues([request],{p0:[invalid]})).toEqual({});
    expect(decodeActivityValues([request],{})).toEqual({});
  });
  it("retains verified non-native costs without needing an ETH quote",()=>{
    expect(decodeActivityValues([{...request,units:0,otherUsd:37.63}],{})[activityKey(activity)].usd).toBe(37.63);
  });
  it("uses a saved valuation only for the same transaction amount and time",()=>{
    const data = structuredClone(snapshot) as AnalyticsData;
    const first = summarize(data,"all","all").activity[0];
    expect(first.usd).toBeGreaterThan(0);
    data.activityValues![activityKey(first)].amount++;
    expect(summarize(data,"all","all").activity[0].usd).toBeNull();
  });
});
