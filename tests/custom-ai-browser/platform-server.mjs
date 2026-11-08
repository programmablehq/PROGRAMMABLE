import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

export async function createPlatformServer(){
  const root=process.cwd();
  const backend=await build({entryPoints:[root+'/tests/custom-ai-browser/platform-api-fixture.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'server-marker',setup(p){p.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'empty'}));p.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));}}]});
  const compiled={exports:{}};new Function('require','module','exports',Buffer.from(backend.outputFiles[0].contents).toString())(createRequire(root+'/package.json'),compiled,compiled.exports);
  const api=await compiled.exports.createPlatformFixture();
  const frontend=await build({stdin:{contents:`
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';import ProjectWorkspace from './components/custom-ai/platform/workspace';
    function App(){const[owner,setOwner]=useState('alice');return <><label>Fixture account<select aria-label="Fixture account" value={owner} onChange={e=>setOwner(e.target.value)}><option>alice</option><option>bob</option></select></label><ProjectWorkspace key={owner} account={'0x'+'a'.repeat(40)} headers={async()=>({Authorization:'Bearer fixture-'+owner})} onLegacy={()=>{}}/></>;}createRoot(document.getElementById('root')).render(<App/>);
  `,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',outdir:'/fixture',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'public-asset',setup(p){p.onResolve({filter:/^\/brand\//},a=>({path:a.path,external:true}));p.onResolve({filter:/(?:^|\/)wallet-provider$/},()=>({path:'wallet',namespace:'fixture'}));p.onResolve({filter:/^next\/(image|link)$/},a=>({path:a.path,namespace:'fixture'}));p.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:root,contents:a.path==='wallet'?"export function useWallet(){return {wallet:{account:'0x'+'a'.repeat(40)},sessionReady:true,authReady:true,sessionOwner:'alice',openWallet:()=>{}}}":a.path==='next/link'?"import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>;}":"import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}"}));}}]});
  const files=new Map(frontend.outputFiles.map(file=>[file.path.endsWith('.css')?'/fixture.css':'/fixture.js',file.contents]));
  const server=createServer(async(req,res)=>{
    try{
      if(files.has(req.url)){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');return res.end(files.get(req.url));}
      if(req.url.startsWith('/api/')||req.url.startsWith('/fixture/')){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);const result=await api.handle(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{} )}));res.writeHead(result.status,Object.fromEntries(result.headers));return res.end(Buffer.from(await result.arrayBuffer()));
      }
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Programmable project workspace test</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#111110;color:#f4f1eb;font:16px Arial}*{box-sizing:border-box}</style></head><body><main id="root"></main><script type="module" src="/fixture.js"></script></body></html>');
    }catch{res.writeHead(500);res.end('Fixture failed');}
  });
  return {server,close:async()=>{await new Promise(resolve=>server.close(resolve));await api.close();}};
}
