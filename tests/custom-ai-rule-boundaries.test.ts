import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { normalizeRuleSpec } from "../lib/custom-ai/rule-spec";
import { ruleExpectations, type RuleFeedBinding } from "../lib/custom-ai/rule-compiler.server";

const rate={kind:"fixed",buyBps:100,sellBps:100};
const spec=(phases:unknown[])=>normalizeRuleSpec({version:2,requirements:[{id:"fees",text:"Use the declared time fees"}],creatorShareBps:10000,actions:[],phases});
const phase=(id:string,startsAtSeconds:number,endsAtSeconds:number|null,fee:unknown=rate)=>({id,startsAtSeconds,endsAtSeconds,fee,requirementIds:["fees"]});
const ramp={kind:"ramp",fromBuyBps:1000,toBuyBps:100,fromSellBps:100,toSellBps:500,durationSeconds:20};
describe("bounded time-rule expectations",()=>{
  it("checks ten phases without duplicating feed-free cases",()=>{
    const phases=Array.from({length:10},(_,i)=>phase(`p${i}`,i*10,i===9?null:(i+1)*10));
    const rows=ruleExpectations(spec(phases),[]);
    expect(rows).toHaveLength(56);
    expect(new Set(rows.map(row=>`${row.afterSeconds}:${row.buy}`)).size).toBe(rows.length);
    for(let i=1;i<10;i++)for(const time of [i*10-1,i*10,i*10+1])expect(rows.some(row=>row.afterSeconds===time)).toBe(true);
  });
  it("checks both fee directions at the ramp's own end before its phase ends",()=>{
    const rows=ruleExpectations(spec([phase("ramp",0,60,ramp),phase("flat",60,null)]),[]);
    for(const [time,buy,sell] of [[19,145,480],[20,100,500],[21,100,500]] as const){
      expect(rows.find(row=>row.afterSeconds===time&&row.buy)?.totalFeeBps).toBe(buy);
      expect(rows.find(row=>row.afterSeconds===time&&!row.buy)?.totalFeeBps).toBe(sell);
    }
  });
  it("includes ramps nested under a feed condition and preserves all feed variants",()=>{
    const feed:RuleFeedBinding={id:"condition",address:`0x${"11".repeat(20)}`,runtimeCode:"0x00",runtimeHash:`0x${"22".repeat(32)}`,minimum:"0",maximum:"1",maxAge:1800,sourceVersion:"test"};
    const conditional={kind:"conditional",when:{kind:"feed",feedId:feed.id,operator:"gte",value:"1"},then:ramp,otherwise:rate};
    const rows=ruleExpectations(spec([phase("conditional",0,60,conditional),phase("flat",60,null)]),[feed]);
    expect(rows.length).toBeLessThanOrEqual(64);
    for(const time of [19,20,21])expect(rows.filter(row=>row.afterSeconds===time)).toHaveLength(6);
    expect(rows.find(row=>row.afterSeconds===20&&row.buy&&row.feeds?.[0].value==="1"&&row.feeds[0].fresh)?.totalFeeBps).toBe(100);
  });
  it("keeps the existing cap for combinations that genuinely need too many cases",()=>{
    const phases=Array.from({length:16},(_,i)=>phase(`p${i}`,i*10,i===15?null:(i+1)*10));
    expect(()=>ruleExpectations(spec(phases),[])).toThrow("supported bound");
  });
});
