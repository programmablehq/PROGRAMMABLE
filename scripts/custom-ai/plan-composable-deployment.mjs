import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { encodeDeployData, getAddress, getContractAddress, keccak256, stringToHex, toHex } from "viem";
const root=new URL("../../",import.meta.url);
const code=JSON.parse(await readFile(new URL("lib/custom-ai/composable-code.json",root),"utf8"));
const deployments=JSON.parse(await readFile(new URL("lib/custom-ai/deployments.json",root),"utf8"));
const ordered=["CustomAIProgramRouterDeployerV1","CustomAILiquidityProgramDeployerV1","CustomAIFundedProgramDeployerV1","CustomAIExecutionPriceFeedV1","CustomAIProgramFactoryV1","CustomAIDataFeedV2"];

export function composableDeploymentPlan({chainId,deployer,reporter,nonce}) {
  if(![1,4663].includes(chainId)||!Number.isSafeInteger(nonce)||nonce<0)throw Error("Invalid deployment network or nonce");
  deployer=getAddress(deployer);reporter=getAddress(reporter);
  const core=deployments.networks[String(chainId)];
  if(core?.status!=="active")throw Error("The core is not active");
  const addresses=ordered.map((_,i)=>getContractAddress({from:deployer,nonce:BigInt(nonce+i)}));
  const steps=ordered.map((name,i)=>{
    const artifact=code.contracts[name];
    const args=i<3?[]:i===3?[reporter]:i===4?[core.factory.address,...addresses.slice(0,4)]
      :[keccak256(stringToHex("london-rain-v1")),keccak256(stringToHex("open-meteo-model-rain-v1")),reporter,0n,1000000n,1800n];
    const data=encodeDeployData({abi:artifact.abi,bytecode:artifact.initCode,args});
    return {name,from:deployer,nonce:nonce+i,predictedAddress:addresses[i],data,value:"0x0",runtimeTemplate:artifact.runtimeTemplate};
  });
  return {version:1,chainId,deployer,reporter,coreFactory:core.factory.address,coreRuntimeHash:core.factory.runtimeHash,
    bundleHash:code.bundleHash,steps,planHash:createHash("sha256").update(JSON.stringify(steps)).digest("hex")};
}
export async function estimateComposableDeployment({chainId,deployer,reporter,rpcUrls}) {
  if(!Array.isArray(rpcUrls)||rpcUrls.length!==2||new Set(rpcUrls.map(url=>new URL(url).origin)).size!==2)throw Error("Two independent read providers are required");
  let calls=0;
  const rpc=async(url,method,params)=>{
    const endpoint=new URL(url);if(endpoint.protocol!=="https:"||endpoint.username||endpoint.password)throw Error("Invalid read provider");
    calls++;
    const response=await fetch(endpoint,{method:"POST",redirect:"error",headers:{"content-type":"application/json","user-agent":"Programmable-Rollout-Readback/1.0"},body:JSON.stringify({jsonrpc:"2.0",id:calls,method,params}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error(`Read provider returned HTTP ${response.status}`);
    const raw=await response.text();if(raw.length>500000)throw Error("Read provider response exceeded bound");
    const data=JSON.parse(raw);if(data.error)throw Error(`Read provider rejected ${method}: ${String(data.error.message).slice(0,150)}`);
    return data.result;
  };
  const both=async(method,params)=>Promise.all(rpcUrls.map(url=>rpc(url,method,params)));
  const ids=await both("eth_chainId",[]);if(ids.some(id=>Number(BigInt(id))!==chainId))throw Error("Read provider network differs");
  const nonces=await both("eth_getTransactionCount",[getAddress(deployer),"pending"]);if(nonces[0]!==nonces[1])throw Error("Deployer nonce is changing");
  const plan=composableDeploymentPlan({chainId,deployer,reporter,nonce:Number(BigInt(nonces[0]))});
  const core=await both("eth_getCode",[plan.coreFactory,"latest"]);if(core.some(c=>keccak256(c)!==plan.coreRuntimeHash))throw Error("Core runtime differs from the active release");
  const gasPrices=await both("eth_gasPrice",[]);const gasPrice=gasPrices.map(BigInt).reduce((a,b)=>a>b?a:b);
  const balances=await both("eth_getBalance",[plan.deployer,"latest"]);
  const overrides={};const estimates=[];
  for(const step of plan.steps){
    const state={...overrides,[plan.deployer]:{balance:toHex(10n**22n),nonce:toHex(step.nonce)}};
    const gas=await both("eth_estimateGas",[{from:plan.deployer,data:step.data,value:"0x0"},"latest",state]);
    const gasLimit=gas.map(BigInt).reduce((a,b)=>a>b?a:b)*120n/100n+10000n;
    estimates.push({name:step.name,predictedAddress:step.predictedAddress,nonce:step.nonce,gasLimit:String(gasLimit),dataHash:keccak256(step.data)});
    overrides[step.predictedAddress]={code:step.runtimeTemplate};
  }
  const totalGas=estimates.reduce((n,e)=>n+BigInt(e.gasLimit),0n),feeCeilingPerGas=gasPrice*2n;
  return {chainId,deployer:plan.deployer,reporter:plan.reporter,planHash:plan.planHash,bundleHash:plan.bundleHash,
    observedAt:new Date().toISOString(),expiresAt:Date.now()+120000,broadcast:false,rpcCalls:calls,steps:estimates,
    balanceWei:balances.map(BigInt).reduce((a,b)=>a<b?a:b).toString(),gasPriceWei:String(gasPrice),feeCeilingPerGasWei:String(feeCeilingPerGas),
    gasCeilingWei:String(totalGas*feeCeilingPerGas),note:"Read-only estimates use state overrides for preceding deployments. Recheck nonce, balances and fees before any separately authorized signing."};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [chain,deployer,reporter]=process.argv.slice(2);
  const rpcUrls=[process.env.CUSTOM_AI_PLAN_RPC_PRIMARY,process.env.CUSTOM_AI_PLAN_RPC_SECONDARY];
  const result=await estimateComposableDeployment({chainId:Number(chain),deployer,reporter,rpcUrls});
  console.log(JSON.stringify(result,null,2));
}
