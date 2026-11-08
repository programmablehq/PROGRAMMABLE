import {build} from "esbuild";
import {createServer} from "node:http";
export async function createGameEventsServer(){
 const repo=process.cwd();
 const bundled=await build({absWorkingDir:repo,entryPoints:["tests/custom-ai-browser/game-events-ui.tsx"],bundle:true,write:false,outdir:"work/game-events-browser",format:"esm",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'}});
 const files=new Map(bundled.outputFiles.map(file=>[file.path.endsWith(".css")?"/app.css":"/app.js",file.contents]));
 return createServer((req,res)=>{const route=new URL(req.url,"http://127.0.0.1").pathname;if(route==="/"){res.setHeader("Content-Type","text/html");res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:16px;font-family:system-ui;background:#111;color:white}input,select,textarea,button{font:inherit}main{min-width:0}</style><div id="root"></div><script type="module" src="/app.js"></script></html>');return;}const file=files.get(route);if(!file){res.writeHead(404).end();return;}res.setHeader("Content-Type",route.endsWith(".css")?"text/css":"text/javascript");res.end(file);});
}
