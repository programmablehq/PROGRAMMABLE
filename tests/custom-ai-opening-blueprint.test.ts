import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createGeneralDeploymentBlueprint, checkedGeneralDeploymentBlueprint } from "../lib/custom-ai/deployment-blueprint";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const production=projectLaunchProductionContext(captured.chains["1"],1,protection);
const intent:LaunchIntent={version:1,id:"opening-declaration",revision:"a".repeat(64),unresolved:[],changes:[],requirements:[{id:"floor",text:"Use the protected USD opening floor.",kind:"constraint",open:null,origin:{kind:"legacy"}}]};
const entries=[{source:"Project.sol",contract:"Initializer",role:"liquidity"},{source:"Project.sol",contract:"Token",role:"token"},{source:"Project.sol",contract:"Hook",role:"hook"}] as const;
function raw(){
  const target=(id:string,contract:string,args:unknown[],initializer:{function:string;arguments:unknown[]}|null,hookPermissions:number|null)=>({id,source:"Project.sol",contract,constructorArguments:args,initializer,deploymentValue:"0",initializerValue:initializer?{input:"funding"}:"0",hookPermissions});
  return {targets:[target("initializer","Initializer",[],{function:"initialize",arguments:[{target:"hook"},{binding:"opening-tick"}]},null),
    target("token","Token",[{input:"name"},{input:"symbol"}],null,null),target("hook","Hook",[{target:"token"},{binding:"opening-sqrt-price-x96"}],null,8192)],
  pool:{token:"token",hook:"hook",initializer:"initializer",platformFeeBinding:"hook",fee:0,tickSpacing:60},fees:{buyPpm:7000,sellPpm:7000},
  liquidityModel:"launch-seeded-concentrated-liquidity",openingPrice:{supply:(10n**27n).toString(),targetFdvUsd:"15000"}};
}
const create=(value:unknown)=>createGeneralDeploymentBlueprint(value,[...entries],production,intent);
describe("opening price declarations",()=>{
  it("preserves explicit opening parameters through the source-bound round trip",()=>{
    const result=create(raw());expect(result.openingPrice).toEqual(raw().openingPrice);
    expect(checkedGeneralDeploymentBlueprint(JSON.parse(JSON.stringify(result)),[...entries],production,intent)).toEqual(result);
    expect(create({...raw(),openingPrice:{...raw().openingPrice,targetFdvUsd:"20000"}}).id).not.toBe(result.id);
  });
  it("requires the declaration for opening bindings",()=>{
    const {openingPrice:ignored,...without}=raw();void ignored;
    expect(()=>create(without)).toThrow();
  });
  it("refuses an unused opening declaration",()=>{
    const value=raw();value.targets[0].initializer!.arguments=[{target:"hook"},"0"];
    value.targets[2].constructorArguments=[{target:"token"},"1"];
    expect(()=>create(value)).toThrow();
  });
  it.each(["below floor","wrong liquidity","wrong spacing","excess supply"])("rejects %s",reason=>{
    const value=raw();
    if(reason==="below floor")value.openingPrice.targetFdvUsd="14999";
    if(reason==="wrong liquidity")value.liquidityModel="external-concentrated-liquidity";
    if(reason==="wrong spacing")value.pool.tickSpacing=1;
    if(reason==="excess supply")value.openingPrice.supply=(1n<<127n).toString();
    expect(()=>create(value)).toThrow();
  });
});
