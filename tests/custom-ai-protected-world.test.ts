import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContractProject } from "../lib/custom-ai/contract-project";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { createGeneralCheckBlueprint, bindGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import { checkGeneralScenarios } from "../lib/custom-ai/behavior-checks.server";
import { parseV4CheckWorld } from "../lib/custom-ai/behavior-world";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const treasury="0xD88539d3c4C460136a733A3Fd60cf6BF269079da";
const nativeStart=10n**24n,initialBuy=10n**16n,buy=10n**15n;
const platformFees=33045090859661n,creatorFees=77105212005875n,nativeOut=14879983688021n;
const bought=65867011962192775326n,amountSold=10n**18n;
const sqrtPrice="20436017594860784101246733423247",tick="111060";
const intent:LaunchIntent={version:1,id:"protected-pool-baseline",revision:"a".repeat(64),unresolved:[],changes:[],requirements:[
  {id:"surface",kind:"constraint",text:`Only the declared original protection interfaces; opening-fee treasury ${treasury}.`,open:null,origin:{kind:"legacy"}},
  {id:"launch",kind:"behavior",text:"Seed the pool and enforce the USD 15000 opening floor.",open:null,origin:{kind:"legacy"}},
  {id:"trade",kind:"behavior",text:"Execute settled buys and sells through the authenticated router.",open:null,origin:{kind:"legacy"}},
  {id:"fees",kind:"behavior",text:"Record the expected platform and creator fees.",open:null,origin:{kind:"legacy"}},
  {id:"claims",kind:"behavior",text:"Pay only fixed fee recipients and reject repeated claims.",open:null,origin:{kind:"legacy"}},
]};
type Parameter={type:string;components?:Parameter[]};
type AbiEntry={type:string;name:string;stateMutability?:string;inputs?:Parameter[];outputs?:Parameter[]};
type Artifact={sourcePath:string;contractName:string;abi:AbiEntry[]};
const type=(p:Parameter):string=>p.type.startsWith("tuple")?`(${p.components!.map(type).join(",")})${p.type.slice(5)}`:p.type;
const surface=(a:Artifact)=>a.abi.filter(f=>f.type==="function").map(f=>`function ${f.name}(${f.inputs!.map(type).join(",")})${f.stateMutability==="nonpayable"?"":` ${f.stateMutability}`}${f.outputs?.length?` returns (${f.outputs.map(type).join(",")})`:""}`);

async function fixture(chain:1|4663|8453|999,wrongRecipient=false,constructorSlots=0){
 const prefix=chain===999?"HyperEvm":chain===8453?"Base":"";
 const root=join(process.cwd(),"packages/launch/contracts",chain===999?"hyperevm-launch-protection-v1":chain===8453?"base-launch-protection-v1":"launch-protection-v1");
 const names=[`${prefix}ProtectedNativeInitializerV1`,"ProtectedLaunchTokenV1",`${prefix}ProtectedNative30HookV1`,"EthereumNativeFeeVaultV3",`${prefix}LaunchProtectionModuleV1`];
 const artifacts=await Promise.all(names.map(async name=>JSON.parse(await readFile(join(root,name+".artifact.json"),"utf8")) as Artifact));
 const standard=JSON.parse(await readFile(join(root,"standard-json.json"),"utf8"));
 const contract=(id:string,index:number,role:string,args:unknown[],more:Record<string,unknown>={})=>({id,source:artifacts[index].sourcePath,contract:artifacts[index].contractName,role,arguments:args,functions:surface(artifacts[index]),allowReceive:artifacts[index].abi.some(f=>f.type==="receive"),allowFallback:artifacts[index].abi.some(f=>f.type==="fallback"),surfaceRequirements:["surface"],...more});
 const manager={fixture:"pool-manager"},router={fixture:"v4-router"},creator={account:"creator"},trader={account:"trader-a"},token={contract:"token"},initializer={contract:"initializer"},hook={contract:"hook"};
 const zeros=Array(6).fill("0x0000000000000000000000000000000000000000");
 const child=(id:string,index:number,nonce:string,args:unknown[])=>contract(id,index,"auxiliary",args,{parent:"hook",creation:"create",nonce,value:"0"});
 const step=(id:string,contract:string,signature:string,args:unknown[],patch:Record<string,unknown>={})=>({id,contract,signature,arguments:args,from:"creator",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"},...patch});
 const view=(id:string,contract:string,signature:string,args:unknown[],result:unknown,rule:string,seconds:number)=>step(id,contract,signature,args,{read:true,afterSeconds:seconds,requirementIds:[rule],expect:{status:"success",returns:[typeof result==="bigint"?result.toString():result]}});
 const key={pool:true},zero="0x0000000000000000000000000000000000000000";
 const raw={compilerProfile:"viair-200-v1",world:{kind:"v4-protected-native-token-v1",token:"token",hook:"hook",initializer:"initializer",hookPermissions:0x20cc,fee:0,tickSpacing:60,sqrtPriceX96:sqrtPrice,nativeUsdAnswer:(10n**BigInt(chain===999?18:8)).toString()},
  contracts:[contract("initializer",0,"liquidity",[manager,creator,{fixture:"native-usd-feed"},{fixtureHash:"native-usd-feed"}]),
   contract("token",1,"token",["Protected baseline","PB",(10n**27n).toString(),initializer,manager]),
   contract("hook",2,"hook",[manager,[token,"0","60",sqrtPrice,initializer,creator,"70","70",zero,"0"],creator,router,{fixtureHash:"v4-router"},zeros])],
  constructorChildren:[child("fee-vault",3,"1",[manager,creator]),child("protection-module",4,"2",[hook,token,creator,router,{fixtureHash:"v4-router"},"70",zeros]),child("tax-vault",3,"3",[manager,treasury])],
  allowedCalls:[creator,trader,{account:"trader-b"},treasury,...["initializer","token","hook","fee-vault","protection-module","tax-vault"].map(contract=>({contract}))],
  steps:[step("initialize","initializer","initialize(address,address,int24,address,uint256)",[hook,token,tick,creator,"1"],{value:initialBuy.toString(),expect:{status:"success",swapFeePpm:0}}),
   view("initialized","initializer","initialized()",[],true,"launch",0),view("opening-floor","initializer","openingFdvUsd()",[],"15030","launch",0),
   step("buy","v4-router","swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes)",[key,[true,(-buy).toString(),"4295128740"],"0x"],{from:"trader-a",value:buy.toString(),afterSeconds:31}),
   view("bought-tokens","token","balanceOf(address)",[trader],bought,"trade",31),
   step("approve","token","approve(address,uint256)",[router,amountSold.toString()],{from:"trader-a",afterSeconds:32}),
   step("sell","v4-router","swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes)",[key,[false,(-amountSold).toString(),"1461446703485210103287273052203988822378723970341"],"0x"],{from:"trader-a",afterSeconds:32}),
   view("settled-sale","v4-router","nativeBalance(address)",[trader],nativeStart-buy+nativeOut,"trade",32),
   view("sold-tokens","token","balanceOf(address)",[trader],bought-amountSold,"trade",32),
   view("platform-fees","fee-vault","platformAccrued()",[],platformFees,"fees",33),view("creator-fees","fee-vault","creatorAccrued()",[],creatorFees,"fees",33),
   view("creator-before-claim","v4-router","nativeBalance(address)",[creator],nativeStart-initialBuy,"claims",33),
   step("claim-creator","fee-vault","claimCreator()",[],{from:"trader-a",afterSeconds:33,expect:{status:"success",returns:[creatorFees.toString()]}}),
   view("creator-paid","v4-router","nativeBalance(address)",[creator],nativeStart-initialBuy+creatorFees,"claims",33),
   step("claim-platform","fee-vault","claimPlatform()",[],{from:"trader-a",afterSeconds:33,expect:{status:"success",returns:[platformFees.toString()]}}),
   view("treasury-paid","v4-router","nativeBalance(address)",[treasury],platformFees,"claims",33),
   step("duplicate-claim","fee-vault","claimCreator()",[],{from:"trader-a",afterSeconds:33,requirementIds:["claims"],expect:{status:"revert"}}),
  ]};
 const blueprint=createGeneralCheckBlueprint(raw,intent,chain,"cancun");
 if(wrongRecipient){const path=artifacts[3].sourcePath,source=standard.sources[path].content;expect(source).toContain("_claim(creatorRecipient, amount, false)");standard.sources[path].content=source.replace("_claim(creatorRecipient, amount, false)","_claim(PLATFORM_RECIPIENT, amount, false)");}
 if(constructorSlots){
  const path=artifacts[2].sourcePath,source=standard.sources[path].content;
  standard.sources[path].content=source.replace("    uint256 public immutable CHAIN_ID;", `    uint256[${constructorSlots}] private constructorState;\n    uint256 public immutable CHAIN_ID;`)
   .replace("        CHAIN_ID = block.chainid;", `        for(uint256 i;i<${constructorSlots};++i) constructorState[i]=i+1;\n        CHAIN_ID = block.chainid;`);
  expect(standard.sources[path].content).not.toBe(source);
 }
 const project=createContractProject({compiler:blueprint.compiler,sources:standard.sources,entrypoints:blueprint.entrypoints},intent,chain);
 const compilation=await compileContractProject(project);expect(compilation.compiled).toBe(true);
 return {project,compilation,plan:bindGeneralCheckBlueprint(blueprint,project),raw};
}

describe("protected world declaration boundaries",()=>{
 it("gives a repairable initializer role error before source generation",()=>{
  const rules:LaunchIntent={...intent,requirements:[intent.requirements[0]],unresolved:[]};
  const declaration=(role:"auxiliary"|"liquidity")=>({
   world:{kind:"v4-protected-native-token-v1",token:"token",hook:"hook",initializer:"initializer",hookPermissions:0x20cc,fee:0,tickSpacing:60,sqrtPriceX96:sqrtPrice,nativeUsdAnswer:"300000000000"},
   contracts:([['initializer','Initializer',role],['token','Token','token'],['hook','Hook','hook']] as const).map(([id,contract,entryRole])=>({
    id,contract,source:"Project.sol",role:entryRole,arguments:[],functions:["function ready() view returns (bool)"],allowReceive:false,allowFallback:false,surfaceRequirements:["surface"]})),
   allowedCalls:[],steps:[{id:"initializer-read",contract:"initializer",signature:"ready()",arguments:[],from:"creator",afterSeconds:0,value:"0",read:true,requirementIds:[],expect:{status:"success",returns:[true]}}]
  });
  expect(()=>createGeneralCheckBlueprint(declaration("auxiliary"),rules,8453,"cancun")).toThrow("protected-world-initializer:initializer:requires-liquidity-role");
  const result=createGeneralCheckBlueprint(declaration("liquidity"),rules,8453,"cancun");
  expect(result.entrypoints.find(entry=>entry.contract==="Initializer")?.role).toBe("liquidity");
  expect(result.scenarios.steps[0].expect.returns).toEqual([true]);
 });
 it("binds the fixed fixture revision and rejects a changed or incomplete world",()=>{
  const raw={kind:"v4-protected-native-token-v1",token:"token",hook:"hook",initializer:"initializer",hookPermissions:0x20cc,fee:0,tickSpacing:60,sqrtPriceX96:sqrtPrice,nativeUsdAnswer:"1000000000000000000"};
  const ids=new Set(["token","hook","initializer"]),world=parseV4CheckWorld(raw,ids);
  expect(world.kind).toBe("v4-protected-native-token-v1");expect(world).toHaveProperty("fixture.hash");
  for(const patch of [{...raw,initializer:"hook"},{...raw,nativeUsdAnswer:"0"},{...raw,feedUrl:"https://example.com"},{...world,fixture:{version:"wrong",hash:"0".repeat(64)}}])expect(()=>parseV4CheckWorld(patch,ids)).toThrow();
 });
});
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("original source in the declared protected pool",()=>{
 it("uses the bounded constructor allowance for a hook deployed through CREATE2",async()=>{
  const input=await fixture(8453,false,320),report=await checkGeneralScenarios(input.project,input.compilation,input.plan);
  expect(report.failures).toEqual([]);expect(report.passed).toBe(true);expect(report.launchReady).toBe(false);
 },90000);
 it.each([1,4663,8453,999] as const)("executes initialization, trades and fixed fee claims on chain %s",async chain=>{
  const input=await fixture(chain),projectHash=input.project.hash,artifactHash=input.compilation.artifactHash;
  if(chain===8453){
   const withoutSwap=structuredClone(input.raw);withoutSwap.steps[0].contract="hook";
   expect(()=>createGeneralCheckBlueprint(withoutSwap,intent,chain,"cancun")).toThrow("not-a-direct-hook-call");
   const wrongFee=structuredClone(input.raw);Object.assign(wrongFee.steps[0].expect,{swapFeePpm:3000});
   expect(()=>createGeneralCheckBlueprint(wrongFee,intent,chain,"cancun")).toThrow("fixed-pool-lp-fee");
  }
  const pending=checkGeneralScenarios(input.project,input.compilation,input.plan);
  if(chain===999){
   input.project.sources[input.project.entrypoints[0].source].content="contract ChangedAfterStart {}";
   input.compilation.contracts[0].creationBytecode="0x00";
   input.plan.steps[1].expect.returns=[false];
  }
  const report=await pending;
  expect(report.failures).toEqual([]);expect(report.passed).toBe(true);expect(report.launchReady).toBe(false);
  expect(report.projectHash).toBe(projectHash);expect(report.artifactHash).toBe(artifactHash);
 },90000);
 it("catches a creator payment redirected in otherwise compiling source",async()=>{
  const input=await fixture(999,true),report=await checkGeneralScenarios(input.project,input.compilation,input.plan);
  expect(report.passed).toBe(false);expect(report.failures).toContainEqual(expect.objectContaining({caseId:"creator-paid",code:"return-value"}));
 },90000);
});
