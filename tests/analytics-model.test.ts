import { describe, expect, it } from "vitest";
import { decodeResult, summarize, type AnalyticsData } from "@/lib/analytics/model";

const result = (rows: Record<string,unknown>[]) => ({rows,available:true,updatedAt:"2026-10-14T00:00:00Z"});
const hash = "1".repeat(64);
function fixture(): AnalyticsData { return {
  volume: result([{day:"2026-10-13 00:00:00.000 UTC",chain:"Ethereum",volume_usd:100,unpriced_swaps:2,launched_tokens:10},{day:"2026-10-12 00:00:00.000 UTC",chain:"Robinhood",volume_usd:200,unpriced_swaps:0,launched_tokens:10}]),
  revenue:result([{day:"2026-10-13 00:00:00.000 UTC",chain:"Ethereum",priced_collected_subtotal_usd:3,unpriced_claims:1}]),
  buybacks:result([{buyback_events_v1:`1|${hash}|5|2026-10-13 01:00:00|1;4663|${hash}|9|2026-10-13 01:00:00|2`}]),
  burns:result([{chain:"Robinhood",sender_address:"0x39544a7023081b56d7405c1af0bfaf72da7e24f6",transaction_hash:`0x${hash}`,v4_burned:2,burn_time_utc:"2026-10-13 01:00:00.000 UTC",log_index:1},{chain:"Ethereum",sender_address:"0x39544a7023081b56d7405c1af0bfaf72da7e24f6",transaction_hash:`0x${hash}`,v4_burned:4,burn_time_utc:"2026-10-13 01:00:00.000 UTC",log_index:1}]),
}; }
describe("public analytics",()=>{
  it("sums pool facts once, not repeated window totals, and keeps partial USD explicit",()=>{const s=summarize(fixture(),"all","all");expect(s.volume).toBe(300);expect(s.revenue).toBe(3);expect(s.unpricedSwaps).toBe(2);expect(s.unpricedClaims).toBe(1);expect(s.launches).toBe(10);});
  it("does not combine different token generations",()=>{const d=fixture();const s=summarize(d,"all","all");expect(s.bought).toBe(9);expect(s.legacyBought).toBe(5);expect(s.burned).toBe(2);expect(s.legacyBurned).toBe(4);expect(summarize(d,"Ethereum","all").bought).toBe(5);});
  it("deduplicates repeated burn logs but includes distinct burns in one transaction",()=>{const d=fixture();d.burns.rows.push({...d.burns.rows[0]},{...d.burns.rows[0],log_index:2,v4_burned:3},{...d.burns.rows[0],sender_address:"0x0000000000000000000000000000000000000001",log_index:3,v4_burned:200});const s=summarize(d,"Robinhood","all");expect(s.burned).toBe(5);expect(s.activity.filter(a=>a.kind==="Burn")).toHaveLength(1);});
  it("uses UTC calendar boundaries for period filters",()=>{const s=summarize(fixture(),"all","7d",Date.parse("2026-10-20T12:00:00Z"));expect(s.volume).toBe(0);expect(s.bought).toBe(0);expect(s.activity).toHaveLength(0);});
  it("rejects partial or unfinished source results and leaves missing metrics unavailable",()=>{expect(()=>decodeResult({state:"QUERY_STATE_EXECUTING",result:{rows:[]}})).toThrow();expect(()=>decodeResult({state:"QUERY_STATE_COMPLETED",execution_ended_at:"2026-10-14T00:00:00Z",next_offset:1000,result:{rows:[]}})).toThrow();const d=fixture();d.revenue.available=false;expect(summarize(d,"all","all").revenue).toBeNull();});
});
