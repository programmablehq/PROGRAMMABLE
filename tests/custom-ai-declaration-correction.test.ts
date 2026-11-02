import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {applyDeclarationCorrection,declarationCorrectionSchema,declarationCorrectionView} from "../lib/custom-ai/declaration-correction";
import {prepareSurplusSchema} from "../lib/custom-ai/surplus-schema.server";
describe("bounded declaration corrections",()=>{
  it("preserves unchanged data while applying exact typed replacements",()=>{
    const base={contracts:[{id:"counter",arguments:["old"]}],steps:[{id:"read",contract:"hook"}]};
    const answer={changes:[{path:"/contracts/0/arguments",valueJson:'["new"]'},{path:"/steps/0/contract",valueJson:'"v4-router"'}]};
    expect(JSON.parse(prepareSurplusSchema(declarationCorrectionSchema).decode(JSON.stringify(answer)))).toEqual(answer);
    expect(applyDeclarationCorrection(base,answer)).toEqual({contracts:[{id:"counter",arguments:["new"]}],steps:[{id:"read",contract:"v4-router"}]});
    expect(base.contracts[0].arguments).toEqual(["old"]);
  });
  it.each(["/__proto__/polluted","/constructor/prototype","/contracts/-1","/contracts/4","/missing/id","/contracts/0/id~2bad"])("rejects unsafe or nonexistent path %s",path=>{
    expect(()=>applyDeclarationCorrection({contracts:[{id:"counter"}]},{changes:[{path,valueJson:'"x"'}]})).toThrow();
    expect(({} as {polluted?:unknown}).polluted).toBeUndefined();
  });
  it("rejects ambiguous overlapping updates and unsupported operations",()=>{
    const change={path:"/contracts",valueJson:'[]'};
    expect(()=>applyDeclarationCorrection({contracts:[]},{changes:[change,change]})).toThrow();
    expect(()=>applyDeclarationCorrection({contracts:[{}]},{changes:[change,{path:"/contracts/0/id",valueJson:'"x"'}]})).toThrow();
    expect(()=>applyDeclarationCorrection({contracts:[]},{changes:[{...change,execute:true}]})).toThrow();
    expect(()=>applyDeclarationCorrection({},{changes:[{path:"/new",valueJson:'{"__proto__":{"polluted":true}}'}]})).toThrow();
  });
  it("addresses stable identities and preserves original array order",()=>{
    const base={contracts:[{id:"z",arguments:[]},{id:"a",arguments:[]}],steps:[{id:"buy",value:"1"}],deployment:{targets:[{id:"a",initializer:null}]}};
    const view=declarationCorrectionView(base);
    expect(declarationCorrectionView(view,true)).toEqual(base);
    const fixed=applyDeclarationCorrection(view,{changes:[{path:"/steps/buy/value",valueJson:'"2"'}]});
    expect(declarationCorrectionView(fixed,true)).toEqual({...base,steps:[{id:"buy",value:"2"}]});
    expect(()=>declarationCorrectionView(applyDeclarationCorrection(view,{changes:[{path:"/steps/buy/id",valueJson:'"sell"'}]}),true)).toThrow();
  });
});
