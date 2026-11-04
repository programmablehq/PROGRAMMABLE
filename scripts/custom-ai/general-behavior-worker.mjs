import {createRequire} from "node:module";
import {join} from "node:path";
import {createGeneralV4World} from "./general-v4-world.mjs";
import {createGeneralProtectedV4World} from "./general-protected-v4-world.mjs";
import {declaredEventsMatch} from "./declared-events.mjs";
import {createExecutionRecorder} from "./execution-trace.mjs";
const requireTool=createRequire(join(process.argv[2],"package.json"));
let input="";process.stdin.setEncoding("utf8");
process.stdin.on("data",chunk=>{input+=chunk;if(Buffer.byteLength(input)>6_000_000)process.exit(3);});
process.stdin.on("end",async()=>{try{process.stdout.write(JSON.stringify(await check(JSON.parse(input))));}catch{process.exitCode=4;}});

async function check({chainId,evmVersion,contracts,plan,recordExecution=false}){
 const {createVM}=requireTool("@ethereumjs/vm"),{createCustomCommon,Mainnet,Hardfork}=requireTool("@ethereumjs/common"),{createBlock}=requireTool("@ethereumjs/block");
 const {createAddressFromString,createAccount,hexToBytes,bytesToHex}=requireTool("@ethereumjs/util");
 const {parseAbi,toFunctionSignature,encodeDeployData,encodeFunctionData,encodeAbiParameters}=requireTool("viem");
 const common=createCustomCommon({chainId},Mainnet,{hardfork:evmVersion==="cancun"?Hardfork.Cancun:Hardfork.Paris});
 const vm=await createVM({common}),accounts={creator:"0x1000000000000000000000000000000000000001","trader-a":"0x2000000000000000000000000000000000000002","trader-b":"0x3000000000000000000000000000000000000003"};
 for(const address of Object.values(accounts))await vm.stateManager.putAccount(createAddressFromString(address),createAccount({balance:10n**24n}));
 const deployed=new Map(),failures=[];let cases=0,gasUsed=0n,number=1n,currentCase="setup",activeTargets=new Set(),world,expectedDeployment;
 const recorder=recordExecution?createExecutionRecorder({vm,accounts,deployed,requireTool,plannedSteps:plan.steps.length,recipients:()=>plan.allowedCalls.map(reference=>value(reference))}):undefined;
 const abiType=parameter=>parameter.type.startsWith("tuple")?`(${(parameter.components??[]).map(abiType).join(",")})${parameter.type.slice(5)}`:parameter.type;
 const fail=(code,message)=>{if(failures.length<32)failures.push({caseId:currentCase,code,message:String(message).slice(0,500)});};
 const value=input=>{
  if(Array.isArray(input))return input.map(value);
  if(input&&typeof input==="object"){
   if(input.account&&Object.hasOwn(accounts,input.account))return accounts[input.account];
   if(input.contract&&deployed.has(input.contract))return deployed.get(input.contract).address;
   if(input.fixture&&world?.contracts.has(input.fixture))return world.contracts.get(input.fixture).address;
   if(input.fixtureHash&&world?.contracts.has(input.fixtureHash))return world.contracts.get(input.fixtureHash).runtimeCodeHash;
   if(input.pool===true&&world&&deployed.has(plan.world.token)&&deployed.has(plan.world.hook))return [
    "0x0000000000000000000000000000000000000000",deployed.get(plan.world.token).address,plan.world.fee,plan.world.tickSpacing,deployed.get(plan.world.hook).address,
   ];
   throw Error("The declared fixture reference is not deployed.");
  }return input;
 };
 vm.evm.events?.on("beforeMessage",message=>{
  if(message.depth===0)return;
  if(message.delegatecall){fail("delegated-call","A declared case used delegated execution.");return;}
  if(!message.to){
   if(expectedDeployment&&message.caller.toString().toLowerCase()===expectedDeployment.caller.toLowerCase()
     &&bytesToHex(message.data).toLowerCase()===expectedDeployment.creation.toLowerCase())return;
   fail("undeclared-deployment","A declared case created an unbound child contract.");return;
  }
  const target=message.to.toString().toLowerCase();
  // Standard precompiles are deterministic local execution, never RPCs.
  if(BigInt(target)>0n&&BigInt(target)<=10n)return;
  if(!activeTargets.has(target))fail("unexpected-call","A declared case called a recipient outside its declared call targets.");
 });
 const run=async({to,data,from="creator",afterSeconds=0,value:amount="0",read=false,construction=false})=>{
  // A trusted CREATE2 fixture calls the factory instead of a bare CREATE.
  const gasLimit=!to||construction?15_000_000n:8_000_000n;
  if(gasUsed+gasLimit>150_000_000n)throw Error("The declared checks exceed their total execution budget.");
  activeTargets=new Set(plan.allowedCalls.flatMap(reference=>{try{return [String(value(reference)).toLowerCase()];}catch{return [];}}));
  if(world){
   for(const target of world.contracts.values())activeTargets.add(target.address.toLowerCase());
   for(const id of [plan.world.token,plan.world.hook])if(deployed.has(id))activeTargets.add(deployed.get(id).address.toLowerCase());
  }
  if(to)activeTargets.add(to.toLowerCase());
  await vm.evm.journal.cleanup();vm.stateManager.originalStorageCache.clear();
  const result=await vm.evm.runCall({caller:createAddressFromString(accounts[from]),...(to?{to:createAddressFromString(to)}:{}),data:hexToBytes(data),
   value:BigInt(amount),gasLimit,isStatic:read,skipNonceIncrement:read,
   block:createBlock({header:{number:number++,timestamp:1_800_000_000n+BigInt(afterSeconds),gasLimit:30_000_000n}},{common})});
  gasUsed+=result.execResult.executionGasUsed;return result;
 };
 try{
  if(plan.world){
   if(evmVersion!=="cancun")throw Error("This pinned v4 world requires its Cancun execution profile.");
   world=plan.world.kind==="v4-protected-native-token-v1"
    ?await createGeneralProtectedV4World(requireTool,{vm,common,chainId,run,onBootstrapGas:used=>{gasUsed+=used;}},plan.world)
    :await createGeneralV4World(requireTool,run);
   for(const [id,target] of world.contracts)deployed.set(id,target);
  }
  for(const fixture of plan.contracts){
   currentCase=`surface:${fixture.id}`;const artifact=contracts.find(item=>item.source===fixture.source&&item.contract===fixture.contract);
   if(!artifact)throw Error("The declared fixture is absent from the exact compiler artifacts.");
   const expected=parseAbi(fixture.functions),actual=artifact.abi.filter(item=>item.type==="function");
   if(actual.length!==expected.length||actual.some(fn=>!expected.some(item=>item.type==="function"&&toFunctionSignature(item)===toFunctionSignature(fn)
      &&item.stateMutability===fn.stateMutability&&JSON.stringify((item.outputs??[]).map(abiType))===JSON.stringify((fn.outputs??[]).map(abiType))))) {
    fail("unexpected-interface","The compiled public functions differ from the declared interface.");
   }
   if(artifact.abi.some(item=>item.type==="receive")!==fixture.allowReceive||artifact.abi.some(item=>item.type==="fallback")!==fixture.allowFallback)fail("unexpected-interface","The compiled receive or fallback entry point was not declared.");
   cases++;if(failures.length)break;
   currentCase=`constructor:${fixture.id}`;
   const args=fixture.arguments.map(value);
   const hook=world&&fixture.id===plan.world.hook?await world.deployHook(artifact,args,plan.world.hookPermissions,expected=>{expectedDeployment=expected;}):null;
   const result=hook?.result??await run({data:encodeDeployData({abi:artifact.abi,bytecode:artifact.creationBytecode,args})});cases++;
   const address=hook?hook.address:result.createdAddress?.toString();
   if(result.execResult.exceptionError||!address){fail("constructor","The declared constructor could not execute.");break;}
   deployed.set(fixture.id,{address,artifact});if(failures.length)break;
  }
  if(!failures.length)for(const step of plan.steps){
   currentCase=step.id;const target=deployed.get(step.contract),fn=target?.artifact.abi.find(item=>item.type==="function"&&toFunctionSignature(item)===step.signature);
   if(!fn){fail("undeclared-function","The declared call is absent from this contract interface.");break;}
   const before=await recorder?.before();
   const result=await run({to:target.address,data:encodeFunctionData({abi:[fn],functionName:fn.name,args:step.arguments.map(value)}),from:step.from,
    afterSeconds:step.afterSeconds,value:step.value,read:step.read});cases++;
   await recorder?.record(step,fn,result,before);
   const reverted=Boolean(result.execResult.exceptionError);
   if(reverted!==(step.expect.status==="revert"))fail("execution-status","The declared success or revert expectation did not match.");
   if(!reverted&&step.expect.returns!==undefined){
    const expected=encodeAbiParameters(fn.outputs??[],step.expect.returns.map(value));
    if(bytesToHex(result.execResult.returnValue).toLowerCase()!==expected.toLowerCase())fail("return-value","The declared return value did not match.");
   }
   if(!reverted&&step.expect.swapFeePpm!==undefined){
    const fees=world?.swapFees(result)??[];
    if(fees.length!==1||fees[0]!==step.expect.swapFeePpm)fail("swap-fee","The actual PoolManager swap fee did not match the independent declared expectation.");
   }
   if(!reverted&&step.expect.events&&!declaredEventsMatch(step.expect.events,result.execResult.logs??[],deployed,value,requireTool("viem")))
    fail("event-log","The executed event emitters, arguments, order or count did not match the independent expectations.");
   if(failures.length)break;
  }
 }catch{fail("fixture-execution","The declared fixture could not finish within its supported local execution.");}
 return {passed:failures.length===0,cases,gasUsed:gasUsed.toString(),failures,...(recorder?{execution:recorder.result()}:{})};
}
