import { createServer } from "node:http";
import { build } from "esbuild";

export const walletFixtureModule = String.raw`
import {executeGeneralGraphWalletSend,recoverGeneralGraphWalletSend} from './lib/custom-ai/general-wallet-execution';
import {runWithBrowserWalletRequestLock} from './lib/wallet-request-lock';
import {assertCustomLaunchWalletActionV1} from './lib/custom-launch/wallet-handoff-v1';
import {beginLaunchSendV1,rememberLaunchHashV1,rejectLaunchSendV1} from './lib/custom-launch/launch-send-journal-v1';
async function requestWallet(body){const response=await fetch('/fixture-wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw value;return value.hash;}
export function useWallet(){return {wallet:{account:window.__generalWalletFixture?.subject.controller},
 sendCustomLaunchWalletAction:async(action,boundary)=>{
  const checked=assertCustomLaunchWalletActionV1(action,window.__generalWalletFixture.subject.controller);
  return runWithBrowserWalletRequestLock({sessionSubject:'synthetic-local-wallet',account:checked.from,chainId:checked.chainId,requestSubject:JSON.stringify(['custom-ai-graph-wallet-action-v1',boundary.context.actionHash]),assertCurrentSession:()=>boundary.assertCurrent(),
   execute:()=>executeGeneralGraphWalletSend({action:checked,boundary,assertCurrent:()=>boundary.assertCurrent(),send:()=>requestWallet({kind:'graph',action:checked})})});
 },
 recoverGeneralGraphWalletAction:async(input)=>navigator.locks.request('programmable:wallet-request:v1:'+input.attempt.chainId+':'+input.attempt.controller+':exclusive',{mode:'exclusive',ifAvailable:true},async(lock)=>{
  if(!lock)throw Error('Original wallet request is pending');return recoverGeneralGraphWalletSend({...input,request:async({method,params})=>method==='eth_chainId'?'0x'+Number(input.attempt.chainId).toString(16):(await fetch('/fixture-provider',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})})).json()});
 }),
 sendUniversalLaunchWalletAction:async(input)=>{
  input.signal?.throwIfAborted();const plan=await input.loadFreshResource();input.signal?.throwIfAborted();
  const step=plan.steps.find(s=>s.stepId===input.stepId)||plan.steps.find(s=>s.status==='wallet_action_ready');if(!step)throw Error('No current wallet step');
  const review={sourceVersion:'custom_launch_plan_v1',launchId:plan.planId,stepId:step.stepId,binding:step.transactionDigest,transaction:{chainId:'0x1237',from:plan.plan.controller.address,to:step.transaction.to,data:step.transaction.data,value:'0x'+BigInt(step.transaction.value).toString(16),gas:'0x'+BigInt(step.transaction.gasLimit).toString(16),nonce:'0x'+BigInt(step.transaction.nonce).toString(16)},maxGasCostWei:'1000000',valueWei:step.transaction.value,deadline:step.transaction.deadline,controllerKind:'eoa',preconditions:[],postconditions:[]};
  if(input.action!=='send')return review;
  return runWithBrowserWalletRequestLock({sessionSubject:'synthetic-local-wallet',account:plan.plan.controller.address,chainId:'4663',requestSubject:JSON.stringify(['custom-launch-plan-wallet-v1',review.binding]),assertCurrentSession:()=>input.signal?.throwIfAborted(),execute:async()=>{
   input.signal?.throwIfAborted();const attempt=beginLaunchSendV1(review);try{const hash=await requestWallet({kind:'plan',review});rememberLaunchHashV1(attempt,hash);return hash;}catch(error){rejectLaunchSendV1(attempt,error);throw error;}
  }});
 }};}
`;

export function walletFixturePlugin(root) {
  return { name: "synthetic-wallet-port", setup(plugin) {
    plugin.onResolve({ filter: /^\/brand\// }, args => ({ path: args.path, external: true }));
    plugin.onResolve({ filter: /(?:^|\/)wallet-provider$/ }, () => ({ path: "wallet", namespace: "wallet-fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "wallet-fixture" }, () => ({ contents: walletFixtureModule, loader: "ts", resolveDir: root }));
    plugin.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "wallet-fixture-image" }));
    plugin.onLoad({ filter: /.*/, namespace: "wallet-fixture-image" }, () => ({ contents: "import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}", loader: "tsx", resolveDir: root }));
  } };
}
/** Actual Chat wallet UI with canonical codecs/journals. Wallet and HTTP
 * delivery are test ports; no provider, model, key or mainnet is used. */
export async function createGeneralWalletServer() {
  const root = process.cwd(), bundled = await build({ stdin: { loader: "tsx", resolveDir: root, contents: String.raw`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import GeneralLaunchWallet from './components/custom-ai/general-launch-wallet';
import fixtures from './tests/fixtures/custom-ai-general-wallet-v1.json';import{recordFixture}from'./tests/fixtures/universal-launch-v1';
const chain=Number(new URL(location.href).searchParams.get('chain')||1),plan=chain===4663?recordFixture():null;
const subject=plan?{chainId:4663,controller:plan.plan.controller.address,resourceId:plan.planId,requestHash:plan.planHash,rawRequestSha256:plan.rawRequestSha256,deadline:plan.plan.budgets.deadline}:fixtures.fixtures[String(chain)].subject;
window.__generalWalletFixture={subject};
function App(){const[scope,setScope]=useState('original'),[preparing,setPreparing]=useState(new URL(location.href).searchParams.has('pending'));return <><button onClick={()=>setScope('new')}>Switch private session</button>{preparing&&<button onClick={()=>setPreparing(false)}>Complete preparation</button>}<main style={{maxWidth:460,margin:'40px auto'}}>{scope==='original'?<GeneralLaunchWallet key={scope} subject={subject} name="Local wallet fixture" headers={async()=>({Authorization:'synthetic-local-session'})} disabled={false} preparing={preparing} onStatus={async()=>{await fetch('/fixture-status');}} prepareCommand={new URL(location.href).searchParams.has('automatic')?'explicit-chat-command-1':undefined}/>:<p>New private session</p>}</main></>;}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, platform: "browser", format: "esm", write: false, outdir: "/wallet-fixture", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [walletFixturePlugin(root)] });
  const assets = new Map(bundled.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer((request, response) => {
    if (assets.has(request.url)) { response.setHeader("Content-Type", request.url.endsWith(".css") ? "text/css" : "text/javascript"); response.end(assets.get(request.url)); return; }
    response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#151410;color:#f4f1eb;font:16px/1.5 Arial}*{box-sizing:border-box}button{font:inherit}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
