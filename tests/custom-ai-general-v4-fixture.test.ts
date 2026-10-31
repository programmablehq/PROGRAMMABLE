import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Abi } from "viem";

const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const core=JSON.parse(readFileSync(join(process.cwd(),"scripts/custom-ai/core-bundle.json"),"utf8"));
const trusted=JSON.parse(readFileSync(join(process.cwd(),"scripts/custom-ai/general-v4-fixture.json"),"utf8"));
const closureBytes=readFileSync(join(process.cwd(),"contracts/spec/custom-ai/verification-bundle/standard-input.json"));

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("trusted general v4 world fixture",{timeout:60_000},()=>{
 async function setup(){
  const {hash,...fixture}=trusted,{bundleHash,...bundle}=core;
  expect(sha(JSON.stringify(fixture))).toBe(hash);expect(sha(JSON.stringify(bundle))).toBe(bundleHash);
  expect(sha(readFileSync(join(process.cwd(),"scripts/custom-ai/GeneralV4Fixture.sol")))).toBe(fixture.sourceSha256);
  expect(sha(closureBytes)).toBe(fixture.dependencyClosureSha256);
  const requireTool=createRequire(join(process.env.CUSTOM_AI_COMPILER_DIR!,"package.json"));
  const {createVM}=requireTool("@ethereumjs/vm"),{createCustomCommon,Mainnet,Hardfork}=requireTool("@ethereumjs/common"),{createBlock}=requireTool("@ethereumjs/block");
  const {createAddressFromString,createAccount,hexToBytes,bytesToHex}=requireTool("@ethereumjs/util");
  const {encodeDeployData,encodeFunctionData,decodeFunctionResult,decodeEventLog,getCreate2Address,keccak256,toHex}=requireTool("viem");
  const common=createCustomCommon({chainId:999},Mainnet,{hardfork:Hardfork.Cancun}),vm=await createVM({common});
  const creator="0x1000000000000000000000000000000000000001",trader="0x2000000000000000000000000000000000000002",other="0x3000000000000000000000000000000000000003";
  for(const account of [creator,trader,other])await vm.stateManager.putAccount(createAddressFromString(account),createAccount({balance:10n**24n}));
  let block=1n,seconds=0n;
  const run=async({to,data,from=creator,value=0n,read=false}:{to?:string;data:string;from?:string;value?:bigint;read?:boolean})=>{
   await vm.evm.journal.cleanup();vm.stateManager.originalStorageCache.clear();
   return vm.evm.runCall({caller:createAddressFromString(from),...(to?{to:createAddressFromString(to)}:{}),data:hexToBytes(data),value,gasLimit:20_000_000n,isStatic:read,skipNonceIncrement:read,
    block:createBlock({header:{number:block++,timestamp:1_800_000_000n+seconds,gasLimit:30_000_000n}},{common})});
  };
  const deploy=async(artifact:{abi:Abi;initCode?:string;creationBytecode?:string},args:unknown[]=[])=>{
   const result=await run({data:encodeDeployData({abi:artifact.abi,bytecode:artifact.initCode??artifact.creationBytecode,args})});
   expect(result.execResult.exceptionError).toBeUndefined();expect(result.createdAddress).toBeDefined();return result.createdAddress.toString();
  };
  const call=async(abi:Abi,to:string,name:string,args:unknown[]=[],options:{from?:string;value?:bigint;read?:boolean;revert?:boolean}={})=>{
   const result=await run({to,data:encodeFunctionData({abi,functionName:name,args}),...options});
   if(options.revert)expect(result.execResult.exceptionError).toBeDefined();else expect(result.execResult.exceptionError).toBeUndefined();
   return result;
  };
  const read=async(abi:Abi,to:string,name:string,args:unknown[]=[])=>decodeFunctionResult({abi,functionName:name,data:bytesToHex((await call(abi,to,name,args,{read:true})).execResult.returnValue)});
  const manager=await deploy(core.contracts.PoolManager,[creator]),router=await deploy(trusted,[manager]),token=await deploy(core.contracts.SimulationQuote,[18]);
  const quoteAbi=core.contracts.SimulationQuote.abi,routerAbi=trusted.abi,managerAbi=core.contracts.PoolManager.abi;
  await call(quoteAbi,token,"mint",[creator,10n**24n]);await call(quoteAbi,token,"mint",[trader,10n**20n]);
  for(const from of [creator,trader])await call(quoteAbi,token,"approve",[router,(1n<<256n)-1n],{from});
  const key=(hook="0x0000000000000000000000000000000000000000",fee=3000)=>({currency0:"0x0000000000000000000000000000000000000000",currency1:token,fee,tickSpacing:60,hooks:hook});
  const initialize=async(pool:ReturnType<typeof key>)=>{
   await call(routerAbi,router,"initialize",[pool,1n<<96n]);
   await call(routerAbi,router,"liquidity",[pool,{tickLower:-600,tickUpper:600,liquidityDelta:10n**18n,salt:"0x"+"00".repeat(32)},"0x"],{value:10n**18n});
   expect(await vm.stateManager.getAccount(createAddressFromString(router))).toMatchObject({balance:0n});
  };
  const swap=async(pool:ReturnType<typeof key>,buy:boolean)=>{
   const params={zeroForOne:buy,amountSpecified:-(10n**13n),sqrtPriceLimitX96:buy?4295128740n:1461446703485210103287273052203988822378723970341n};
   const result=await call(routerAbi,router,"swap",[pool,params,"0x"],{from:trader,...(buy?{value:10n**13n}:{})});
   const logs=result.execResult.logs.map((log:[Uint8Array,Uint8Array[],Uint8Array])=>{
    try{return decodeEventLog({abi:managerAbi,topics:log[1].map(bytesToHex),data:bytesToHex(log[2])});}catch{return null;}
   }).filter((log:{eventName?:string}|null)=>log?.eventName==="Swap");
   expect(logs).toHaveLength(1);expect(await vm.stateManager.getAccount(createAddressFromString(router))).toMatchObject({balance:0n});
   return logs[0].args;
  };
  return {requireTool,vm,creator,trader,other,manager,router,token,quoteAbi,routerAbi,managerAbi,run,call,read,key,initialize,swap,setTime:(value:bigint)=>{seconds=value;},getCreate2Address,keccak256,toHex,encodeDeployData};
 }
 it("executes native/token liquidity, a buy, a sell and a token transfer through the real pinned PoolManager",async()=>{
  const f=await setup(),pool=f.key();await f.initialize(pool);
  const before=await f.read(f.quoteAbi,f.token,"balanceOf",[f.trader]);
  const buy=await f.swap(pool,true);expect(buy.fee).toBe(3000);expect(buy.amount0).toBeLessThan(0n);expect(buy.amount1).toBeGreaterThan(0n);
  expect(await f.read(f.quoteAbi,f.token,"balanceOf",[f.trader])).toBeGreaterThan(before);
  const sell=await f.swap(pool,false);expect(sell.amount0).toBeGreaterThan(0n);expect(sell.amount1).toBeLessThan(0n);
  await f.call(f.quoteAbi,f.token,"transfer",[f.other,123n],{from:f.trader});expect(await f.read(f.quoteAbi,f.token,"balanceOf",[f.other])).toBe(123n);
  await f.call(f.routerAbi,f.router,"unlockCallback",["0x"],{from:f.trader,revert:true});
 });
 it("deploys a permission-matched hook and observes its actual dynamic fee on both sides of a ten-minute boundary",async()=>{
  const f=await setup(),solc=f.requireTool("solc"),closure=JSON.parse(closureBytes.toString());
  const source=`pragma solidity 0.8.26;
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
contract TimedHook { address public immutable manager; uint64 public immutable started;
 constructor(address manager_) {manager=manager_;started=uint64(block.timestamp);require(uint160(address(this))&16383==128);}
 function beforeSwap(address,PoolKey calldata,SwapParams calldata,bytes calldata) external view returns(bytes4,BeforeSwapDelta,uint24){require(msg.sender==manager);return(this.beforeSwap.selector,BeforeSwapDelta.wrap(0),uint24(block.timestamp-started<600?3000:500)|0x400000);}
}`;
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:"Solidity",sources:{...closure.sources,"TimedHook.sol":{content:source}},settings:{optimizer:{enabled:true,runs:1000},evmVersion:"cancun",remappings:closure.settings.remappings,
   metadata:{bytecodeHash:"none",appendCBOR:false},outputSelection:{"TimedHook.sol":{"TimedHook":["abi","evm.bytecode.object"]}}}})));
  expect(compiled.errors?.filter((item:{severity:string})=>item.severity==="error")??[]).toEqual([]);
  const artifact=compiled.contracts["TimedHook.sol"].TimedHook,creation=f.encodeDeployData({abi:artifact.abi,bytecode:"0x"+artifact.evm.bytecode.object,args:[f.manager]}),bytecodeHash=f.keccak256(creation);
  let salt="",hook="";
  for(let n=0;n<200_000;n++){salt=f.toHex(n,{size:32});hook=f.getCreate2Address({from:f.router,salt,bytecodeHash});if((BigInt(hook)&16383n)===128n)break;}
  expect(BigInt(hook)&16383n).toBe(128n);await f.call(f.routerAbi,f.router,"deploy",[creation,salt]);
  const pool=f.key(hook,0x800000);await f.initialize(pool);
  await f.call(artifact.abi,hook,"beforeSwap",[f.trader,pool,{zeroForOne:true,amountSpecified:-1n,sqrtPriceLimitX96:4295128740n},"0x"],{from:f.trader,revert:true});
  f.setTime(599n);expect((await f.swap(pool,true)).fee).toBe(3000);
  f.setTime(600n);expect((await f.swap(pool,false)).fee).toBe(500);
 });
});
