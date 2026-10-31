import { describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { createContractProject,GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import { createGeneralCheckBlueprint,bindGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { checkGeneralScenarios } from "../lib/custom-ai/behavior-checks.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import { V4_WORLD_STEP_SIGNATURES } from "../lib/custom-ai/behavior-world";

const intent:LaunchIntent={version:1,id:"v4-counter-world",revision:"a".repeat(64),unresolved:[],changes:[],requirements:[
 {id:"fees",text:"The actual dynamic pool fee is3000ppm until599seconds after initialization, then500ppm from600seconds",kind:"behavior",open:null,origin:{kind:"legacy"}},
 {id:"transfer",text:"Token transfers preserve the exact amount",kind:"behavior",open:null,origin:{kind:"legacy"}},
 {id:"auth",text:"Hook callbacks require the bound PoolManager",kind:"behavior",open:null,origin:{kind:"legacy"}},
 {id:"no-admin",text:"No owner mint, seizure, withdrawal or upgrade functions",kind:"constraint",open:null,origin:{kind:"legacy"}},
]};
const key="(address,address,uint24,int24,address)",params="(bool,int256,uint160)",max=((1n<<256n)-1n).toString();
function declaration(){
 const step=(id:string,contract:string,signature:string,args:unknown[],patch:Record<string,unknown>={})=>({id,contract,signature,arguments:args,from:"creator",afterSeconds:0,value:"0",read:false,requirementIds:[],expect:{status:"success"},...patch});
 return {world:{kind:"v4-native-token-v1",token:"coin",hook:"hook",hookPermissions:8320,fee:0x800000,tickSpacing:60,sqrtPriceX96:(1n<<96n).toString()},
  contracts:[
   {id:"coin",source:"Coin.sol",contract:"Coin",role:"token",arguments:[{account:"creator"}],functions:["function totalSupply() view returns (uint256)","function balanceOf(address) view returns (uint256)","function allowance(address,address) view returns (uint256)","function approve(address,uint256) returns (bool)","function transfer(address,uint256) returns (bool)","function transferFrom(address,address,uint256) returns (bool)"],allowReceive:false,allowFallback:false,surfaceRequirements:["no-admin"]},
   {id:"hook",source:"Hook.sol",contract:"Hook",role:"hook",arguments:[{fixture:"pool-manager"}],functions:["function manager() view returns (address)","function started() view returns (uint64)","function poolHash() view returns (bytes32)",`function beforeInitialize(address,${key},uint160) returns (bytes4)`,`function beforeSwap(address,${key},${params},bytes) view returns (bytes4,int256,uint24)`],allowReceive:false,allowFallback:false,surfaceRequirements:["no-admin"]},
  ],allowedCalls:[{account:"creator"},{account:"trader-a"},{account:"trader-b"}],steps:[
   step("initialize","v4-router",V4_WORLD_STEP_SIGNATURES[0],[{pool:true},(1n<<96n).toString()]),
   step("approve-creator","coin","approve(address,uint256)",[{fixture:"v4-router"},max]),
   step("liquidity","v4-router",V4_WORLD_STEP_SIGNATURES[1],[{pool:true},["-600","600",(10n**18n).toString(),"0x"+"00".repeat(32)],"0x"],{value:(10n**18n).toString()}),
   step("fund-trader","coin","transfer(address,uint256)",[{account:"trader-a"},(10n**20n).toString()]),
   step("approve-trader","coin","approve(address,uint256)",[{fixture:"v4-router"},max],{from:"trader-a"}),
   step("buy-before-boundary","v4-router",V4_WORLD_STEP_SIGNATURES[2],[{pool:true},[true,(-(10n**13n)).toString(),"4295128740"],"0x"],{from:"trader-a",afterSeconds:599,value:(10n**13n).toString(),requirementIds:["fees"],expect:{status:"success",swapFeePpm:3000}}),
   step("sell-at-boundary","v4-router",V4_WORLD_STEP_SIGNATURES[2],[{pool:true},[false,(-(10n**13n)).toString(),"1461446703485210103287273052203988822378723970341"],"0x"],{from:"trader-a",afterSeconds:600,requirementIds:["fees"],expect:{status:"success",swapFeePpm:500}}),
   step("transfer-exact","coin","transfer(address,uint256)",[{account:"trader-b"},"123"],{from:"trader-a",afterSeconds:600}),
   step("read-exact","coin","balanceOf(address)",[{account:"trader-b"}],{read:true,afterSeconds:600,requirementIds:["transfer"],expect:{status:"success",returns:["123"]}}),
   step("reject-direct-callback","hook",`beforeSwap(address,${key},${params},bytes)`,[{account:"trader-a"},{pool:true},[true,"-1","4295128740"],"0x"],{from:"trader-a",afterSeconds:600,requirementIds:["auth"],expect:{status:"revert"}}),
  ]};
}
function project(fee=3000,hidden=false){
 return createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},sources:{
  "Coin.sol":{content:`pragma solidity 0.8.26; contract Coin {uint256 public totalSupply=10**27; mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256))public allowance;
constructor(address creator){balanceOf[creator]=totalSupply;} function approve(address spender,uint256 amount)external returns(bool){allowance[msg.sender][spender]=amount;return true;} function transfer(address to,uint256 amount)external returns(bool){balanceOf[msg.sender]-=amount;balanceOf[to]+=amount;return true;} function transferFrom(address from,address to,uint256 amount)external returns(bool){if(allowance[from][msg.sender]!=type(uint256).max)allowance[from][msg.sender]-=amount;balanceOf[from]-=amount;balanceOf[to]+=amount;return true;}}`},
  "Hook.sol":{content:`pragma solidity 0.8.26; struct Key {address currency0;address currency1;uint24 fee;int24 tickSpacing;address hooks;} struct Params {bool zeroForOne;int256 amountSpecified;uint160 sqrtPriceLimitX96;}
contract Hook {address public immutable manager;uint64 public started;bytes32 public poolHash; constructor(address m){manager=m;require(uint160(address(this))&16383==8320);} function beforeInitialize(address,Key calldata k,uint160)external returns(bytes4){require(msg.sender==manager&&started==0);started=uint64(block.timestamp);poolHash=keccak256(abi.encode(k));return this.beforeInitialize.selector;} function beforeSwap(address,Key calldata k,Params calldata,bytes calldata)external view returns(bytes4,int256,uint24){require(msg.sender==manager&&started!=0&&poolHash==keccak256(abi.encode(k)));${hidden?"if(address(0x4000000000000000000000000000000000000004).balance>0)return(this.beforeSwap.selector,0,uint24(900)|0x400000);":""}return(this.beforeSwap.selector,0,uint24(block.timestamp-started<600?${fee}:500)|0x400000);}}`},
 },entrypoints:[{source:"Coin.sol",contract:"Coin",role:"token"},{source:"Hook.sol",contract:"Hook",role:"hook"}]},intent,999);
}

describe("declared v4 world binding",()=>{
 it("binds the pool, role and trusted fixture references before source exists",()=>{
  const blueprint=createGeneralCheckBlueprint(declaration(),intent,999,"cancun"),plan=bindGeneralCheckBlueprint(blueprint,project());
  expect(plan.world).toMatchObject({token:"coin",hook:"hook",hookPermissions:8320});expect(plan.steps[5].expect.swapFeePpm).toBe(3000);
  expect(()=>createGeneralCheckBlueprint(declaration(),intent,999,"paris")).toThrow();
  for(const patch of [{...declaration(),world:{...declaration().world,manager:"https://example.com"}},{...declaration(),world:{...declaration().world,token:"unknown"}},
   {...declaration(),contracts:declaration().contracts.map(item=>item.id==="coin"?{...item,role:"auxiliary"}:item)},
   {...declaration(),steps:declaration().steps.map((step,index)=>index===5?{...step,signature:"deploy(bytes,bytes32)"}:step)},
   {...declaration(),steps:declaration().steps.map((step,index)=>index===0?{...step,arguments:[{pool:true},"2"]}:step)},
  ])expect(()=>createGeneralCheckBlueprint(patch,intent,999,"cancun")).toThrow();
 });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("declared generated hooks in the actual isolated v4 world",{timeout:60_000},()=>{
 it.each([3000,2700])("executes actual liquidity/buy/sell/transfer and independently checks the%i-ppm implementation",async fee=>{
  const source=project(fee),compiled=await compileContractProject(source),plan=bindGeneralCheckBlueprint(createGeneralCheckBlueprint(declaration(),intent,999,"cancun"),source);
  expect(compiled.compiled).toBe(true);const report=await checkGeneralScenarios(source,compiled,plan);
  expect(report.passed).toBe(fee===3000);expect(report.launchReady).toBe(false);
  if(fee===3000)expect(report.cases).toBe(14);else expect(report.failures).toEqual([expect.objectContaining({caseId:"buy-before-boundary",code:"swap-fee"})]);
 });
});
