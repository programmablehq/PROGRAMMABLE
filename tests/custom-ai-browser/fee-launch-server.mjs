import {createServer} from "node:http";
import {build} from "esbuild";

// Render the actual fee launch preview. HTTP and wallet ports are local test
// doubles; no model, RPC provider or wallet extension is called.
export async function createFeeLaunchServer() {
  const root=process.cwd();
  const bundle=await build({stdin:{loader:"tsx",resolveDir:root,contents:`
    import React,{useState,useCallback}from'react';import{createRoot}from'react-dom/client';
    import{CustomAILaunchPreview}from'./components/custom-ai/launch-preview';
    const parameters=new URL(location.href).searchParams,hash='a'.repeat(64),draftId='saved-fee-source-0001';
    const draft={source:'synthetic fee fixture',sourceHash:hash,compiled:true,diagnostics:[],validation:{status:'passed'},verification:{status:'passed',sourceHash:hash,requirements:['Charge 3% on buys and sells'],checks:[],cases:8}};
    function App(){
      const[settings,setSettings]=useState({name:parameters.has('missing-name')?'':'Fee fixture',symbol:'FEE',chainId:1,pairToken:'ETH',initialBuy:'0.01',description:'A local fee fixture',website:'https://example.com',x:''});
      const[command,setCommand]=useState();const[receipt,setReceipt]=useState({id:'b'.repeat(64),url:'/image.svg'});
      const headers=useCallback(async()=>({Authorization:'synthetic-local-session'}),[]);
      return <><button onClick={()=>setCommand({id:'chat-command-1',sourceId:draftId})}>Ask to launch in chat</button>
        <button onClick={()=>setCommand({id:'stale-command-1',sourceId:'another-draft'})}>Stale launch request</button>
        <CustomAILaunchPreview draft={draft} settings={settings} disabled={false} chatRevision={0} onChange={patch=>setSettings(s=>({...s,...patch}))}
          draftId={draftId} headers={headers} localPreview={false} cacheKey="fee-launch-fixture" onLaunchLocked={()=>{}}
          imageReceipt={receipt} onImageReceipt={setReceipt} onKeepRules={()=>{}} onStartAnother={()=>{}} onEditRule={()=>{}} launchCommand={command}/></>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,format:"esm",platform:"browser",write:false,outdir:"/fee-fixture",jsx:"automatic",
  define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},plugins:[{name:"local-fee-ports",setup(plugin){
    plugin.onResolve({filter:/(?:^|\/)wallet-provider$/},()=>({path:"wallet",namespace:"fee-fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fee-fixture"},()=>({loader:"ts",resolveDir:root,contents:`export function useWallet(){return {wallet:{account:'0x'+'1'.repeat(40)},openWallet:()=>{},sendCustomAIWalletStep:async(id,step)=>{const response=await fetch('/fixture-wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,step})});if(!response.ok)throw Error('Wallet rejected');return response.json();}};}`}));
    plugin.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"fee-image"}));
    plugin.onLoad({filter:/.*/,namespace:"fee-image"},()=>({loader:"tsx",resolveDir:root,contents:"import React from'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}"}));
    plugin.onResolve({filter:/^\/brand\//},args=>({path:args.path,external:true}));
  }}]});
  const assets=new Map(bundle.outputFiles.map(file=>[file.path.endsWith('.css')?'/fixture.css':'/fixture.js',file.contents]));
  return createServer((request,response)=>{
    if(assets.has(request.url)){response.setHeader('Content-Type',request.url.endsWith('.css')?'text/css':'text/javascript');response.end(assets.get(request.url));return;}
    if(request.url==='/image.svg'){response.setHeader('Content-Type','image/svg+xml');response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#aaa"/></svg>');return;}
    response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
