import {createRequire} from "node:module";
import {join} from "node:path";
import {createGeneralV4World} from "./general-v4-world.mjs";
const requireTool=createRequire(join(process.argv[2],"package.json"));
let input="";process.stdin.setEncoding("utf8");
process.stdin.on("data",chunk=>{input+=chunk;if(Buffer.byteLength(input)>6_000_000)process.exit(3);});
process.stdin.on("end",async()=>{try{process.stdout.write(JSON.stringify(await check(JSON.parse(input))));}catch{process.exitCode=4;}});

async function check({chainId,evmVersion,contracts,plan}){
 const {createVM}=requireTool("@ethereumjs/vm"),{createCustomCommon,Mainnet,Hardfork}=requireTool("@ethereumjs/common"),{createBlock}=requireTool("@ethereumjs/block");
 const {createAddressFromString,createAccount,hexToBytes,bytesToHex}=requireTool("@ethereumjs/util");
 const {parseAbi,toFunctionSignature,encodeDeployData,encodeFunctionData,encodeAbiParameters,getContractAddress,getCreate2Address,keccak256}=requireTool("viem");
 if(plan.version!==2||!Array.isArray(plan.constructorChildren)||!plan.constructorChildren.length||plan.contracts.length+plan.constructorChildren.length>16)throw Error();
 const common=createCustomCommon({chainId},Mainnet,{hardfork:evmVersion==="cancun"?Hardfork.Cancun:Hardfork.Paris});
 const vm=await createVM({common}),accounts={creator:"0x1000000000000000000000000000000000000001","trader-a":"0x2000000000000000000000000000000000000002","trader-b":"0x3000000000000000000000000000000000000003"};
 for(const address of Object.values(accounts))await vm.stateManager.putAccount(createAddressFromString(address),createAccount({balance:10n**24n}));
 const deployed=new Map(),failures=[],frames=[],observed=new Set(),nextChild=new Map();
 let cases=0,gasUsed=0n,number=1n,currentCase="setup",activeTargets=new Set(),world,expectedDeployment,currentConstructor;
 const abiType=parameter=>parameter.type.startsWith("tuple")?`(${(parameter.components??[]).map(abiType).join(",")})${parameter.type.slice(5)}`:parameter.type;
 const fail=(code,message)=>{if(failures.length<32)failures.push({caseId:currentCase,code,message:String(message).slice(0,500)});};
 const value=input=>{
  if(Array.isArray(input))return input.map(value);
  if(input&&typeof input==="object"){
   if(input.account&&Object.hasOwn(accounts,input.account))return accounts[input.account];
   if(input.contract&&deployed.has(input.contract))return deployed.get(input.contract).address;
   if(input.fixture&&world?.contracts.has(input.fixture))return world.contracts.get(input.fixture).address;
   if(input.pool===true&&world&&deployed.has(plan.world.token)&&deployed.has(plan.world.hook))return [
    "0x0000000000000000000000000000000000000000",deployed.get(plan.world.token).address,plan.world.fee,plan.world.tickSpacing,deployed.get(plan.world.hook).address,
   ];
   throw Error("The declared fixture reference is not deployed.");
  }return input;
 };
 vm.evm.events?.on("beforeMessage",message=>{
  if(message.depth===0){frames.push(!message.to&&currentConstructor?{kind:"constructor",target:currentConstructor}:{kind:"call"});return;}
  const parent=frames.at(-1);
  if(message.delegatecall){frames.push({kind:"call"});fail("delegated-call","A declared case used delegated execution.");return;}
  if(!message.to){
   if(expectedDeployment&&message.caller.toString().toLowerCase()===expectedDeployment.caller.toLowerCase()
     &&bytesToHex(message.data).toLowerCase()===expectedDeployment.creation.toLowerCase()&&message.salt!==undefined&&currentConstructor){
    const address=getCreate2Address({from:expectedDeployment.caller,salt:bytesToHex(message.salt),bytecodeHash:keccak256(message.data)});
    deployed.set(currentConstructor.id,{address,artifact:currentConstructor.artifact});
    frames.push({kind:"constructor",target:{...currentConstructor,address}});return;
   }
   const child=["constructor","child"].includes(parent?.kind)?plan.constructorChildren.filter(child=>child.parent===parent.target.id)[nextChild.get(parent.target.id)??0]:undefined;
   const artifact=child?contracts.find(item=>item.source===child.source&&item.contract===child.contract):undefined;
   if(child&&artifact&&message.salt===undefined&&message.caller.toString().toLowerCase()===parent.target.address.toLowerCase()
     &&message.value===BigInt(child.value)&&bytesToHex(message.data).toLowerCase()===encodeDeployData({abi:artifact.abi,bytecode:artifact.creationBytecode,args:child.arguments.map(value)}).toLowerCase()){
    const address=getContractAddress({from:parent.target.address,nonce:BigInt(child.nonce)});
    nextChild.set(parent.target.id,(nextChild.get(parent.target.id)??0)+1);
    deployed.set(child.id,{address,artifact});frames.push({kind:"child",target:{...child,address,artifact}});return;
   }
   frames.push({kind:"call"});
   fail("undeclared-deployment","A declared case created an unbound child contract.");return;
  }
  frames.push({kind:"call"});
  const target=message.to.toString().toLowerCase();
  // Standard precompiles are deterministic local execution, never RPCs.
  if(BigInt(target)>0n&&BigInt(target)<=10n)return;
  if(!activeTargets.has(target))fail("unexpected-call","A declared case called a recipient outside its declared call targets.");
 });
 vm.evm.events?.on("afterMessage",result=>{
  const frame=frames.pop();if(frame?.kind!=="child")return;
  cases++;
  if(result.execResult.exceptionError||result.createdAddress?.toString().toLowerCase()!==frame.target.address.toLowerCase()||observed.has(frame.target.id)){
   fail("constructor-child","A declared child did not execute at its original parent and nonce.");return;
  }
  observed.add(frame.target.id);
  if(plan.allowedCalls.some(reference=>reference?.contract===frame.target.id))activeTargets.add(frame.target.address.toLowerCase());
 });
 const run=async({to,data,from="creator",afterSeconds=0,value:amount="0",read=false})=>{
  const gasLimit=to?8_000_000n:15_000_000n;
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
   world=await createGeneralV4World(requireTool,run);
   for(const [id,target] of world.contracts)deployed.set(id,target);
  }
  for(const fixture of [...plan.contracts,...plan.constructorChildren]){
   currentCase=`surface:${fixture.id}`;const artifact=contracts.find(item=>item.source===fixture.source&&item.contract===fixture.contract);
   if(!artifact)throw Error("The declared fixture is absent from the exact compiler artifacts.");
   const expected=parseAbi(fixture.functions),actual=artifact.abi.filter(item=>item.type==="function");
   if(actual.length!==expected.length||actual.some(fn=>!expected.some(item=>item.type==="function"&&toFunctionSignature(item)===toFunctionSignature(fn)
      &&item.stateMutability===fn.stateMutability&&JSON.stringify((item.outputs??[]).map(abiType))===JSON.stringify((fn.outputs??[]).map(abiType))))) {
    fail("unexpected-interface","The compiled public functions differ from the declared interface.");
   }
   if(artifact.abi.some(item=>item.type==="receive")!==fixture.allowReceive||artifact.abi.some(item=>item.type==="fallback")!==fixture.allowFallback)fail("unexpected-interface","The compiled receive or fallback entry point was not declared.");
   cases++;if(failures.length)break;
  }
  if(!failures.length)for(const fixture of plan.contracts){
   const artifact=contracts.find(item=>item.source===fixture.source&&item.contract===fixture.contract);
   currentCase=`constructor:${fixture.id}`;
   const account=await vm.stateManager.getAccount(createAddressFromString(accounts.creator));
   const predicted=getContractAddress({from:accounts.creator,nonce:account?.nonce??0n});
   currentConstructor={...fixture,address:predicted,artifact};deployed.set(fixture.id,{address:predicted,artifact});
   const args=fixture.arguments.map(value);
   const hook=world&&fixture.id===plan.world.hook?await world.deployHook(artifact,args,plan.world.hookPermissions,expected=>{expectedDeployment=expected;}):null;
   const result=hook?.result??await run({data:encodeDeployData({abi:artifact.abi,bytecode:artifact.creationBytecode,args}),value:fixture.value??"0"});cases++;
   currentConstructor=undefined;
   const address=hook?hook.address:result.createdAddress?.toString();
   if(result.execResult.exceptionError||!address){fail("constructor","The declared constructor could not execute.");break;}
   deployed.set(fixture.id,{address,artifact});if(failures.length)break;
  }
  if(!failures.length&&(frames.length||plan.constructorChildren.some(child=>!observed.has(child.id))))fail("constructor-child-missing","A declared constructor child was not actually created.");
  if(!failures.length)for(const step of plan.steps){
   currentCase=step.id;const target=deployed.get(step.contract),fn=target?.artifact.abi.find(item=>item.type==="function"&&toFunctionSignature(item)===step.signature);
   if(!fn){fail("undeclared-function","The declared call is absent from this contract interface.");break;}
   const result=await run({to:target.address,data:encodeFunctionData({abi:[fn],functionName:fn.name,args:step.arguments.map(value)}),from:step.from,
    afterSeconds:step.afterSeconds,value:step.value,read:step.read});cases++;
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
   if(failures.length)break;
  }
 }catch{fail("fixture-execution","The declared fixture could not finish within its supported local execution.");}
 return {passed:failures.length===0,cases,gasUsed:gasUsed.toString(),failures};
}
