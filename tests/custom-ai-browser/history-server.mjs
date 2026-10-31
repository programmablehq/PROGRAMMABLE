import {createServer} from "node:http";
import {build} from "esbuild";
export async function createHistoryServer(){
 const root=process.cwd();
 const bundled=await build({stdin:{contents:`
 import React,{createContext,useContext,useState} from 'react';import{createRoot}from'react-dom/client';
 import{CustomAIWorkspace}from'./components/custom-ai/workspace';import{FixtureProvider}from'fixture-wallet';
 import'./app/globals.css';import'./app/interface.css';import'./app/programmable-experience.css';import'./app/webde-final-ui.css';import'./app/surfaces.css';
 createRoot(document.getElementById('root')).render(<FixtureProvider><main style={{maxWidth:1200,margin:'auto',padding:20}}><CustomAIWorkspace/></main></FixtureProvider>);
 `,loader:"tsx",resolveDir:root},bundle:true,format:"esm",platform:"browser",write:false,outdir:"/fixture-output",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},plugins:[{name:"history-boundaries",setup(p){
 p.onResolve({filter:/^(fixture-wallet|@\/components\/wallet-provider)$/},()=>({path:"wallet",namespace:"fixture"}));
 p.onResolve({filter:/^next\/(image|link)$/},a=>({path:a.path,namespace:"fixture"}));
 p.onLoad({filter:/.*/,namespace:"fixture"},a=>({loader:"tsx",resolveDir:root,contents:a.path==="wallet"?`
 import React,{createContext,useContext,useState}from'react';const C=createContext(null);const account='0x'+'a'.repeat(40);
 const getAccessToken=async()=>'synthetic-local-session',getIdentityToken=async()=>null;
 export function FixtureProvider({children}){const[value,setValue]=useState(account);return <C.Provider value={{wallet:{account:value,chainId:'1'},getAccessToken,getIdentityToken,openWallet:()=>{}}}><button onClick={()=>setValue(value===account?'0x'+'b'.repeat(40):account)}>Switch sample wallet</button>{children}</C.Provider>;}export const useWallet=()=>useContext(C);
 `:a.path==="next/link"?"import React from'react';export default function Link({prefetch,...props}){return <a {...props}/>;}":"import React from'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}"}));
 }}]});
 const files=new Map(bundled.outputFiles.map(f=>[f.path.endsWith('.css')?'/fixture.css':'/fixture.js',f.contents]));
 return createServer((request,response)=>{if(files.has(request.url)){response.setHeader('Content-Type',request.url.endsWith('.css')?'text/css':'text/javascript');response.end(files.get(request.url));return;}
 response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#090b0c;color:#f4f4f4;font:16px/1.5 Arial}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');});
}
