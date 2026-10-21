import { createServer } from 'node:http';
import { build } from 'esbuild';

/** Real Explore lifecycle, deterministic empty catalog, no provider access. */
export async function createExploreVisibilityServer() {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {UnifiedLaunchesView, UnifiedProfileLaunches} from './components/robinhood-launches-view';
    import './app/globals.css'; import './app/programmable-experience.css'; import './app/interface.css'; import './app/webde-final-ui.css'; import './app/surfaces.css';
    const standalone=new URLSearchParams(location.search).has('standalone');
    const params=new URLSearchParams(location.search);
    function Profile() {
      const [account,setAccount]=useState('0x'+'aa'.repeat(20));
      const [rewardsAccount,setRewardsAccount]=useState(null);
      return <main className="page-width"><h1>Profile</h1><button onClick={()=>setAccount('0x'+'bb'.repeat(20))}>Switch fixture wallet</button>
        <UnifiedProfileLaunches account={account} launchChainId={params.get('chain')==='1'?1:4663}
          enableClaims={!params.has('public')} onEthereumClaim={()=>{}} onAllRewards={()=>setRewardsAccount(account)}/>
        {rewardsAccount?<output aria-label="Rewards account">{rewardsAccount}</output>:null}
      </main>;
    }
    createRoot(document.getElementById('root')).render(params.has('profile')?<Profile/>:<main>
      {!standalone?<section style={{height:1400}}><h1>Introduction</h1></section>:null}
      <UnifiedLaunchesView embedded={!standalone}/></main>);
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', outdir: '/fixture-output',
    external: ['/fonts/*', '/brand/*'], define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [{ name: 'boundaries', setup(p) {
      p.onResolve({filter:/^(next\/(link|navigation|image)|@\/components\/view-chain)$/}, a=>({path:a.path,namespace:'stub'}));
      p.onLoad({filter:/.*/,namespace:'stub'}, a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='next/link'
        ? 'import React from "react";export default function Link({prefetch,...props}){return <a {...props}/>}'
        : a.path==='next/image' ? 'import React from "react";export default function Image({priority,fill,unoptimized,...props}){return <img {...props}/>}'
        : a.path==='next/navigation' ? 'export const useRouter=()=>({prefetch:()=>{}});export const usePathname=()=>"/";'
        : 'export const useRouteViewChain=()=>({hydrated:true,viewChainId:4663});'}));
    }}] });
  const files=new Map(result.outputFiles.map(f=>[f.path.endsWith('.css')?'/fixture.css':'/fixture.js',f.contents]));
  return createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(files.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(files.get(url.pathname));return;}
    if(url.pathname.startsWith('/brand/') || url.pathname.startsWith('/fonts/')) {
      import('node:fs').then(fs=>{ const file=process.cwd()+'/public'+url.pathname; if(fs.existsSync(file)){res.setHeader('Content-Type',url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.png')?'image/png':'font/woff2');res.end(fs.readFileSync(file));}else{res.writeHead(404);res.end();} }); return;
    }
    if(url.pathname==='/api/profile/launches') {
      const account=url.searchParams.get('account'); const total=account==='0x'+'aa'.repeat(20)?12:1;
      const number=Math.min(Number(url.searchParams.get('page')||1),Math.ceil(total/10));
      const rows=Array.from({length:total},(_,index)=>({chainId:index%2?1:4663,category:'custom',mode:'custom',
        launchId:'0x'+String(index+1).padStart(64,'0'),tokenAddress:'0x'+String(index+1).padStart(40,'0'),
        hookAddress:'0x'+'11'.repeat(20),creator:account,transactionHash:'0x'+'22'.repeat(32),blockNumber:'123',
        launchedAt:'2026-10-13T10:00:00Z',name:(total===1?'Other wallet ':'Launch ')+(index+1),symbol:'T'+(index+1),decimals:18}));
      const items=rows.slice((number-1)*10,number*10);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({scope:'all',account,status:'ready',updatedAt:new Date().toISOString(),items,
        presentations:items.map(row=>({chainId:row.chainId,tokenAddress:row.tokenAddress,links:[{label:'website',url:'https://example.com/'}],imageUrl:null,description:null,market:null})),
        page:{number,size:10,totalItems:total,totalPages:Math.ceil(total/10),hasMore:number<Math.ceil(total/10)}}));return;
    }
    if(url.pathname==='/api/explore/launches'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({scope:'all',status:'ready',updatedAt:new Date().toISOString(),items:[],presentations:[],page:{number:1,size:10,totalItems:0,totalPages:0,hasMore:false}}));return;}
    if(url.pathname.startsWith('/api/')){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
