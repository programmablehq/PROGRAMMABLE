import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {recoverScenarioPrefix} from "../lib/custom-ai/scenario-recovery";

const fixed={contracts:[{id:"main",functions:["function count() view returns(uint256)","function echo(string) view returns(string)"]}]};
const row=(id:string,call="main:count()",argumentsJson="[]",returnsJson='["1"]')=>
  [id,call,argumentsJson,"creator",0,"0",true,["counter"],{status:"success",returnsJson,swapFeePpm:null,events:[]}];

describe("bounded scenario prefix recovery",()=>{
  it("preserves complete rows and escaped nested values without completing a cut row",()=>{
    const rows=[row("count"),row("echo","main:echo(string)",JSON.stringify(['an escaped "quote" and ] }']),JSON.stringify(['an escaped "quote" and ] }']))];
    const response='{"steps":['+rows.map(value=>JSON.stringify(value)).join(",")+',["unfinished","main:count()","[';
    expect(JSON.parse(recoverScenarioPrefix(response,fixed)!)).toEqual({steps:rows,complete:false});
    expect(response.endsWith('"[')).toBe(true);
  });
  it("never skips a complete invalid row to salvage a later one",()=>{
    for(const invalid of [row("unknown","main:missing()"),[...row("wrong-type").slice(0,6),"true",...row("wrong-type").slice(7)]]){
      expect(recoverScenarioPrefix('{"steps":['+[row("first"),invalid].map(value=>JSON.stringify(value)).join(",")+",[",fixed)).toBeUndefined();
    }
  });
  it("requires a bounded literal steps array with at least one complete row",()=>{
    for(const response of ['{"steps":[["cut"','prefix {"steps":[]}'," ".repeat(96_001),'{"steps":[]}',
      '{"steps":['+JSON.stringify(row("first"))+';runCode()']){
      expect(recoverScenarioPrefix(response,fixed)).toBeUndefined();
    }
  });
  it("does not turn an interrupted envelope into a completion claim",()=>{
    expect(JSON.parse(recoverScenarioPrefix('{"steps":['+JSON.stringify(row("count"))+'],"complete":tr',fixed)!))
      .toEqual({steps:[row("count")],complete:false});
  });
});
