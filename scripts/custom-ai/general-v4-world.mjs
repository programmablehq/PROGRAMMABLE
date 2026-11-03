import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";

/** Fixed local fixture files only. No generated JavaScript, host imports,
 * external addresses, providers, credentials or live transactions. */
export async function createGeneralV4World(requireTool,run){
 const sha=value=>createHash("sha256").update(value).digest("hex");
 const fixture=JSON.parse(readFileSync(new URL("./general-v4-fixture.json",import.meta.url),"utf8"));
 const core=JSON.parse(readFileSync(new URL("./core-bundle.json",import.meta.url),"utf8"));
 const {hash,...fixtureBody}=fixture,{bundleHash,...coreBody}=core;
 if(fixture.version!=="general-v4-fixture-v1"||hash!=="4293b47ecc95274bd349908df7ac6058325895b613dd17d68fa2430cfe90bb87"
   ||hash!==sha(JSON.stringify(fixtureBody))||bundleHash!=="50f90512fc91a45f6bf2aa204db0a04628540fb21a000309f6288fb46495d249"
   ||bundleHash!==sha(JSON.stringify(coreBody)))throw Error("The trusted v4 fixture does not match its pinned release.");
 const {encodeDeployData,encodeFunctionData,decodeFunctionResult,decodeEventLog,getCreate2Address,keccak256,toHex,bytesToHex}=requireTool("viem");
 const deploy=async(artifact,args)=>{
  const result=await run({data:encodeDeployData({abi:artifact.abi,bytecode:artifact.initCode??artifact.creationBytecode,args})});
  if(result.execResult.exceptionError||!result.createdAddress)throw Error("The trusted v4 fixture could not deploy.");
  return result.createdAddress.toString();
 };
 const manager=await deploy(core.contracts.PoolManager,["0x1000000000000000000000000000000000000001"]),router=await deploy(fixture,[manager]);
 const contracts=new Map([["pool-manager",{address:manager,artifact:core.contracts.PoolManager}],["v4-router",{address:router,artifact:fixture}]]);
 return {contracts,manager,router,
  async deployHook(artifact,args,permissions,signalDeployment){
   const creation=encodeDeployData({abi:artifact.abi,bytecode:artifact.creationBytecode,args}),bytecodeHash=keccak256(creation);
   let predicted,salt;
   for(let n=0;n<200_000;n++){salt=toHex(n,{size:32});predicted=getCreate2Address({from:router,salt,bytecodeHash});if((BigInt(predicted)&16383n)===BigInt(permissions))break;}
   if((BigInt(predicted)&16383n)!==BigInt(permissions))throw Error("A permission-matched hook address was not found within the fixture budget.");
   signalDeployment({caller:router,creation});
   let result;
   try{result=await run({to:router,data:encodeFunctionData({abi:fixture.abi,functionName:"deploy",args:[creation,salt]}),construction:true});}
   finally{signalDeployment(null);}
   if(result.execResult.exceptionError) return {result,address:null};
   const actual=decodeFunctionResult({abi:fixture.abi,functionName:"deploy",data:bytesToHex(result.execResult.returnValue)});
   if(String(actual).toLowerCase()!==predicted.toLowerCase())throw Error("The hook fixture deployment differs from its exact CREATE2 address.");
   return {result,address:predicted};
  },
  swapFees(result){
   return (result.execResult.logs??[]).filter(log=>bytesToHex(log[0]).toLowerCase()===manager.toLowerCase()).flatMap(log=>{
    try{const event=decodeEventLog({abi:core.contracts.PoolManager.abi,topics:log[1].map(bytesToHex),data:bytesToHex(log[2])});return event.eventName==="Swap"?[Number(event.args.fee)]:[];}catch{return [];}
   });
  },
 };
}
