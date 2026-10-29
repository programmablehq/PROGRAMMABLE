import {createServer} from "node:http";
import {build} from "esbuild";
import path from "node:path";
export async function createEvmCustomSwapServer(){
 const bundle=await build({entryPoints:["tests/browser/fixtures/evm-custom-swap.tsx"],bundle:true,format:"esm",platform:"browser",write:false,outdir:"/fixture-output",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"isolated-wallet",setup(b){b.onResolve({filter:/wallet-provider$/},()=>({path:path.resolve("tests/browser/fixtures/evm-custom-wallet.ts")}));}}]});
 const files=new Map(bundle.outputFiles.map(file=>[file.path.endsWith(".css")?"/fixture.css":"/fixture.js",file.contents]));
 return createServer((request,response)=>{if(files.has(request.url)){response.setHeader("Content-Type",request.url.endsWith(".css")?"text/css":"text/javascript");response.end(files.get(request.url));return;}
 response.setHeader("Content-Type","text/html");response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><style>:root{--webde-surface:#171717;--webde-ink:#fff;--webde-muted:#aaa;--webde-line:#444;--webde-control:#242424;--panel-fill-action:#ddd}*{box-sizing:border-box}body{margin:0;background:#111;color:#fff;font:16px/1.5 Arial}main{max-width:500px;padding:16px;margin:auto}button,input,select{min-height:44px}input{color:white;background:#222}button{cursor:pointer}a{color:white}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #9ddac9;outline-offset:3px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');});
}
