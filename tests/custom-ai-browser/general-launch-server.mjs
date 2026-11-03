import {createServer} from "node:http";
import {build} from "esbuild";
import {readFileSync} from "node:fs";
import {walletFixturePlugin} from "./general-wallet-server.mjs";

/** A local rendering host for the actual preview and controls. All mutations
 * are intercepted by the owning test; no model, chain or provider is used. */
export async function createGeneralLaunchServer(){
 const root=process.cwd();
 const assets=new Map(["/brand/networks/hyperevm.png","/brand/networks/robinhood-feather-white.svg"].map(path=>[path,readFileSync(root+"/public"+path)]));
 const bundled=await build({stdin:{contents:`
 import React,{useState,useCallback}from'react';import{createRoot}from'react-dom/client';
 import{GeneralProjectPreview}from'./components/custom-ai/general-preview';import styles from'./components/custom-ai/workspace.module.css';
 import'./app/globals.css';import'./app/interface.css';import'./app/programmable-experience.css';import'./app/webde-final-ui.css';import'./app/surfaces.css';
 const parameters=new URL(location.href).searchParams,chainId=Number(parameters.get('chain')||1),conversation=parameters.get('chat')||'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const intent={version:1,id:'general-browser-intent-0001',revision:'c'.repeat(64),requirements:[{id:'counter',text:'Preserve the declared contract behavior',kind:'behavior',open:null,origin:{kind:'legacy'}}],unresolved:[],changes:[]};
 const image={id:'d'.repeat(64),hash:'e'.repeat(64),url:'/fixture-image.svg'};
 const source={version:1,chainId,intentRevision:intent.revision,projectHash:'sha256:'+'a'.repeat(64),artifactHash:'sha256:'+'b'.repeat(64),summary:'A saved custom contract',compiler:{version:'0.8.26+commit.8a97fa7a',optimizerRuns:1000,viaIR:false,evmVersion:'cancun'},entrypoints:[{source:'Counter.sol',contract:'Counter',role:'auxiliary'}],sourceFiles:1,sourceBytes:240,compiled:true,diagnostics:[],requirementCoverage:'proposed',verification:'not-run',launchReady:false,scenarios:{scope:'isolated-declared-scenarios-v1',hash:'sha256:'+'f'.repeat(64),planHash:'sha256:'+'1'.repeat(64),passed:true,cases:5,failures:[]}};
 function App(){
  const[account,setAccount]=useState('0x'+'1'.repeat(40)),[project,setProject]=useState(parameters.has('unbuilt')?undefined:source),[receipt,setReceipt]=useState(image),[locked,setLocked]=useState(false),[launchCommand,setLaunchCommand]=useState();
  const[settings,setSettings]=useState({name:'Original coin',symbol:'ORIG',chainId,pairToken:chainId===999?'HYPE':'ETH',initialBuy:'0.01',description:parameters.has('missing')?'':'A declared custom launch',website:'https://example.com',x:'https://x.com/example'});
  const headers=useCallback(async()=>({Authorization:'synthetic-local-session'}),[]);
  const flush=async()=>{const response=await fetch('/fixture-studio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account,settings,image:receipt})});if(!response.ok)throw Error('Studio changed');return response.json();};
  return <><button onClick={()=>setAccount('0x'+'2'.repeat(40))}>Switch sample wallet</button><button onClick={()=>{setSettings(s=>({...s,name:'Changed coin'}));setProject(p=>({...p,projectHash:'sha256:'+'2'.repeat(64)}));}}>Change sample coin</button><button onClick={()=>setLaunchCommand({id:'explicit-chat-command-1',sourceId:'source-general-client-0001'})}>Ask to launch in chat</button><button onClick={()=>setLaunchCommand({id:'stale-chat-command-1',sourceId:'another-source-0001'})}>Stale launch request</button><output aria-label="Chat editing">{locked?'Locked':'Available'}</output>
   <main className={styles.workspace}><section className={styles.chatPanel}><h1>Build your contract</h1><p>Local acceptance fixture</p></section>
    <GeneralProjectPreview project={project} intent={intent} draftId="source-general-client-0001" account={account} conversationId={conversation} headers={headers} disabled={false} settings={settings} onChange={patch=>setSettings(s=>({...s,...patch}))} chatRevision={0} localPreview={false} cacheKey={'general-fixture:'+account} imageReceipt={receipt} onImageReceipt={setReceipt} onEditRule={()=>{}} generalLaunchEnabled={!parameters.has('disabled')} flush={flush} onLaunchLocked={setLocked} launchCommand={launchCommand}/>
   </main></>;
 }createRoot(document.getElementById('root')).render(<App/>);
 `,loader:"tsx",resolveDir:root},bundle:true,format:"esm",platform:"browser",write:false,outdir:"/fixture-output",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},plugins:[walletFixturePlugin(root),{name:"local-preview-image",setup(p){
  p.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"fixture"}));
  p.onLoad({filter:/.*/,namespace:"fixture"},()=>({loader:"tsx",resolveDir:root,contents:"import React from'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}"}));
 }}]});
 const files=new Map(bundled.outputFiles.map(file=>[file.path.endsWith('.css')?'/fixture.css':'/fixture.js',file.contents]));
 return createServer((request,response)=>{
  if(request.url==='/fixture-image.svg'){response.setHeader('Content-Type','image/svg+xml');response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#9cae99"/><circle cx="40" cy="40" r="22" fill="#e9ebd9"/></svg>');return;}
  if(assets.has(request.url)){response.setHeader('Content-Type',request.url.endsWith('.svg')?'image/svg+xml':'image/png');response.end(assets.get(request.url));return;}
  if(files.has(request.url)){response.setHeader('Content-Type',request.url.endsWith('.css')?'text/css':'text/javascript');response.end(files.get(request.url));return;}
  response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#090b0c;color:#f4f4f4;font:16px/1.5 Arial}*{box-sizing:border-box}main{max-width:1200px;margin:30px auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
 });
}
