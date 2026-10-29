import { describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { normalizeMarketObservation,type MarketFeedDefinition } from "../lib/custom-ai/feed-adapters/market.server";
const definition:MarketFeedDefinition={id:"coin-price",sourceVersion:"programmable-market-usd6-v1",kind:"market",unit:"micro-USD",chainId:1,token:`0x${"1".repeat(40)}`,metric:"priceUsd",maxAgeSeconds:300};
const response=(value:number,time=1000)=>({items:[{tokenAddress:definition.token,market:{priceUsd:value,observedAt:new Date(time*1000).toISOString()}}]});
describe("source-bound market observations",()=>{
  it("keeps repeated observations stable and records real transitions",()=>{
    const first=normalizeMarketObservation(response(0.00125),definition,1000);
    expect(first.value).toBe("1250");
    expect(normalizeMarketObservation(response(0.00125),definition,1001,first)).toBe(first);
    const changed=normalizeMarketObservation(response(0.0025,1010),definition,1010,first);
    expect(changed.transitionSequence).toBe("1");expect(changed.previousValue).toBe("1250");
  });
  it("rejects stale values, conflicting timestamps and another token",()=>{
    const first=normalizeMarketObservation(response(1),definition,1000);
    expect(()=>normalizeMarketObservation(response(2),definition,1001,first)).toThrow("conflicts");
    expect(()=>normalizeMarketObservation(response(1),definition,2000)).toThrow("stale");
    expect(()=>normalizeMarketObservation({items:[{tokenAddress:`0x${"2".repeat(40)}`} ]},definition,1000)).toThrow("identity");
  });
});
