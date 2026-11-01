import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {PROTECTED_WORLD_FIXTURE_PIN} from "./protected-world-fixture-pin.mjs";

/** Independent, synthetic state at the original chain's fixed dependency
 * addresses. Only the two pinned fixture artifacts can be bootstrapped here;
 * submitted source still follows the normal declared deployment path. */
export async function createGeneralProtectedV4World(requireTool,{vm,common,chainId,run,onBootstrapGas},definition){
 const sha=value=>createHash("sha256").update(value).digest("hex");
 const fixture=JSON.parse(readFileSync(new URL("./general-protected-v4-fixture.json",import.meta.url),"utf8"));
 const core=JSON.parse(readFileSync(new URL("./core-bundle.json",import.meta.url),"utf8"));
 const {hash,...fixtureBody}=fixture,{bundleHash,...coreBody}=core;
 if(fixture.version!==PROTECTED_WORLD_FIXTURE_PIN.version||hash!==PROTECTED_WORLD_FIXTURE_PIN.hash
   ||hash!==sha(JSON.stringify(fixtureBody))||bundleHash!=="50f90512fc91a45f6bf2aa204db0a04628540fb21a000309f6288fb46495d249"
   ||bundleHash!==sha(JSON.stringify(coreBody)))throw Error("The protected fixture differs from its pinned source.");
 const pins=fixture.pins[String(chainId)],answer=definition.nativeUsdAnswer;
 if(!pins||typeof answer!=="string"||!/^[1-9][0-9]{0,38}$/.test(answer)||BigInt(answer)>=(1n<<128n)
   ||definition.fixture?.version!==fixture.version||definition.fixture?.hash!==hash)throw Error("Invalid protected fixture context.");
 const {createAddressFromString,createAccount,hexToBytes,bytesToHex}=requireTool("@ethereumjs/util");
 const {createBlock}=requireTool("@ethereumjs/block");
 const {encodeDeployData,encodeFunctionData,decodeFunctionResult,decodeEventLog,getCreate2Address,keccak256,toHex}=requireTool("viem");
 const creator="0x1000000000000000000000000000000000000001",contracts=new Map();
 let gas=0n;
 const bootstrap=async(id,address,artifact,args)=>{
  const target=createAddressFromString(address);
  if((await vm.stateManager.getCode(target)).length)throw Error("Protected fixture address already exists.");
  await vm.stateManager.putAccount(target,createAccount({nonce:1n}));
  await vm.evm.journal.cleanup();vm.stateManager.originalStorageCache.clear();
  const creation=encodeDeployData({abi:artifact.abi,bytecode:artifact.creationBytecode??artifact.initCode,args});
  const result=await vm.evm.runCall({to:target,caller:createAddressFromString(creator),origin:createAddressFromString(creator),
   code:hexToBytes(creation),data:new Uint8Array(),createdAddresses:new Set(),gasLimit:8_000_000n,
   block:createBlock({header:{number:1n,timestamp:1_800_000_000n,gasLimit:30_000_000n}},{common})});
  gas+=result.execResult.executionGasUsed;
  if(gas>16_000_000n||result.execResult.exceptionError||!result.execResult.returnValue.length)throw Error("Protected fixture construction failed.");
  await vm.stateManager.putCode(target,result.execResult.returnValue);
  contracts.set(id,{address,artifact,runtimeCodeHash:keccak256(bytesToHex(result.execResult.returnValue))});
 };
 await bootstrap("pool-manager",pins.manager,core.contracts.PoolManager,[creator]);
 await bootstrap("v4-router",pins.router,fixture.contracts.GeneralProtectedV4Fixture,[pins.manager]);
 await bootstrap("native-usd-feed",pins.feed,fixture.contracts.GeneralProtectedUsdFeedFixture,
  [chainId===999?18:8,BigInt(answer),1_800_000_000n,1_799_996_399n]);
 if(pins.sequencer)await bootstrap("sequencer-uptime-feed",pins.sequencer,fixture.contracts.GeneralProtectedUsdFeedFixture,
  [0,0n,1_800_000_000n,1_799_996_399n]);
 onBootstrapGas?.(gas);
 return {contracts,manager:pins.manager,router:pins.router,fixture:{version:fixture.version,hash},
  async deployHook(artifact,args,permissions,signalDeployment){
   const creation=encodeDeployData({abi:artifact.abi,bytecode:artifact.creationBytecode,args}),bytecodeHash=keccak256(creation);
   let predicted,salt;
   for(let n=0;n<200_000;n++){
    salt=toHex(n,{size:32});predicted=getCreate2Address({from:pins.router,salt,bytecodeHash});
    if((BigInt(predicted)&16383n)===BigInt(permissions))break;
   }
   if((BigInt(predicted)&16383n)!==BigInt(permissions))throw Error("A protected hook salt was not found within the fixture budget.");
   signalDeployment({caller:pins.router,creation});
   let result;
   try{result=await run({to:pins.router,data:encodeFunctionData({abi:fixture.contracts.GeneralProtectedV4Fixture.abi,functionName:"deploy",args:[creation,salt]})});}
   finally{signalDeployment(null);}
   if(result.execResult.exceptionError)return {result,address:null};
   const actual=decodeFunctionResult({abi:fixture.contracts.GeneralProtectedV4Fixture.abi,functionName:"deploy",data:bytesToHex(result.execResult.returnValue)});
   if(String(actual).toLowerCase()!==predicted.toLowerCase())throw Error("Protected hook deployment differs from its CREATE2 prediction.");
   return {result,address:predicted};
  },
  swapFees(result){
   return (result.execResult.logs??[]).filter(log=>bytesToHex(log[0]).toLowerCase()===pins.manager.toLowerCase()).flatMap(log=>{
    try{const event=decodeEventLog({abi:core.contracts.PoolManager.abi,topics:log[1].map(bytesToHex),data:bytesToHex(log[2])});return event.eventName==="Swap"?[Number(event.args.fee)]:[];}catch{return [];}
   });
  },
 };
}
