import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { build } from "esbuild";

/** Real studio and header with a synthetic catalog. No wallet, RPC or launch actions. */
export async function createModuleStudioServer() {
  const root = process.cwd();
  const entry = `
    import React, {useEffect, useRef, useState} from 'react';
    import {prepareTokenImage} from './lib/token-image';
    import {prepareAvatarImage,prepareProfileBannerImage} from './lib/profile/avatar';
    window.photoTools={prepareTokenImage,prepareAvatarImage,prepareProfileBannerImage};
    import {createRoot} from 'react-dom/client';
    import {FoundationSessionStatus as RealSessionStatus} from './components/module-foundation-session';
    import {FOUNDATION_PENDING_EVENT,readFoundationPending,recoverFoundationPending,readFoundationLaunchRetry} from './lib/module-foundation/wallet';
    import {FOUNDATION_RESOLUTION_EVENT,readFoundationResolution,acknowledgeFoundationResolution} from './lib/module-foundation/result-store';
    import {keccak256} from 'viem';
    import {FoundationStudio} from './components/module-studio/studio';
    import {ModuleFoundationLaunchHost} from './components/module-foundation-launch-host';
    import {ModuleFoundationBuilder} from './components/module-foundation-builder';
    import {FOUNDATION_PLATFORM_FEE_RECIPIENT} from './lib/module-foundation/ui-types';
    import {SiteHeader} from './components/site-navigation';
    import styles from './components/module-studio/studio.module.css';
    import './app/globals.css'; import './app/interface.css';
    import './app/programmable-experience.css'; import './app/webde-final-ui.css'; import './app/surfaces.css';
    const catalog = [{id:'wallet-cap-fixture',version:'1.0.0',digest:'0x'+'11'.repeat(32),name:'Initial wallet buy limit',
      description:'This module limits how much each wallet can buy during the opening period.',capabilities:['beforeSwap'],
      fields:[],available:true,studio:{category:'trading'}},
      ...(new URLSearchParams(location.search).get('mode')==='availability' ? [
        ...['Hot potato','Plague','Reactive pair','Entangled'].map((name,index)=>({id:'ready-'+index,name,available:true})),
        ...['Buyback and burn','Dip buyback','LP rewards','Full-range liquidity','Buyer rewards','Nth-buy pot','King of the Hill'].map((name,index)=>({id:'pending-'+index,name,available:false,comingSoon:true,unavailableReason:'Coming soon. This module is not available for new launches yet.'})),
      ].map(module=>({version:'1.0.0',digest:'0x'+'22'.repeat(32),description:'Fixture module.',capabilities:[],fields:[],studio:{category:'trading'},...module})) : [])];
    const launchEvents = window.launchEvents = {preparations:0,coldPreparations:0,walletRequests:0,aborts:0};
    const chainId = new URLSearchParams(location.search).get('chainId')==='1' ? 1 : 4663;
    const quote = {address:chainId===1?'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2':'0xC91D9BBCEa565eCaA0821DFAff2E377b4FeaDd5f',chainId,name:'Wrapped Ether',symbol:'WETH',decimals:18,supported:true,supportsNativeEth:true};
    function DraftNavigationFixture() {
      const [network,setNetwork] = useState(4663);
      useEffect(()=>{const back=event=>setNetwork(event.state?.chainId??4663);window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
      const change = value=>{history.pushState({chainId:value},'', '#'+value);setNetwork(value);};
      return <><button onClick={()=>change(1)}>Fixture Ethereum</button><button onClick={()=>change(4663)}>Fixture Robinhood</button>
        <ModuleFoundationBuilder key={network} persistDraft layout="studio" contextKey={'draft:'+network}
          availability={{status:'ready',chainId:network,chainName:network===1?'Ethereum':'Robinhood Chain'}}
          catalog={catalog} quoteAssets={[{...quote,chainId:network}]} suggestedInitialBuy="0.001"
          onUploadImage={async()=>{throw new Error('No upload needed');}}
          onPrepareLaunch={async()=>{throw new Error('No transaction in navigation fixture');}}
          onConfirmLaunch={async()=>{throw new Error('No transaction in navigation fixture');}}/></>;
    }
    function PendingRecoveryFixture() {
      const account='0x'+'11'.repeat(20), to='0x'+'22'.repeat(20), hash='0x'+'33'.repeat(32), blockHash='0x'+'44'.repeat(32);
      const key='programmable:foundation-pending:v1:'+chainId+':'+account;
      const [ready,setReady]=useState(false), [,setVersion]=useState(0);
      const [cleared,setCleared]=useState(false);
      const [retryAvailable,setRetryAvailable]=useState(false);
      const unmined=new URLSearchParams(location.search).get('unmined')==='1';
      useEffect(()=>{
        localStorage.setItem(key,JSON.stringify({schemaVersion:'programmable.foundation.pending.v1',chainId,account,to,
          releaseDigest:hash,calldataHash:keccak256('0x1234'),value:'0x0',nonce:7,startBlock:'100',createdAt:1,
          operationId:'11111111-1111-4111-8111-111111111111',transactionHash:null,walletPhase:'requested',
          metadata:{operationKind:'launch',stepKind:'launch',token:to}}));
        const update=()=>setVersion(v=>v+1);
        window.addEventListener(FOUNDATION_PENDING_EVENT,update);window.addEventListener(FOUNDATION_RESOLUTION_EVENT,update);
        setReady(true);return()=>{window.removeEventListener(FOUNDATION_PENDING_EVENT,update);window.removeEventListener(FOUNDATION_RESOLUTION_EVENT,update);};
      },[]);
      if(!ready)return null;
      const pending=readFoundationPending(account,chainId), resolution=readFoundationResolution(account,chainId);
      const tx={hash,from:account,to,input:'0x1234',value:0n,nonce:7,chainId,blockNumber:101n,blockHash};
      const client={chain:{id:chainId},getChainId:async()=>chainId,
        getTransactionCount:async({blockNumber})=>unmined?7:blockNumber<101n?7:8,
        getBlock:async({blockNumber,includeTransactions})=>({number:blockNumber??120n,hash:blockHash,transactions:includeTransactions?[tx]:[]}),
        getTransaction:async()=>tx,getTransactionReceipt:async()=>({...tx,transactionHash:hash,status:'success'})};
      const session={client,account,profile:{explorer:'https://example.invalid'},pending:JSON.stringify(pending),
        pendingTransactionHash:pending?.transactionHash,resolution,resolutionState:JSON.stringify(resolution),progress:'',retryAvailable,
        checkPending:async knownHash=>{try{return await recoverFoundationPending(client,account,knownHash);}
          catch(error){const retry=await readFoundationLaunchRetry(client,account);setRetryAvailable(Boolean(retry));if(!retry)throw error;}},
        acknowledgeResult:async id=>{await acknowledgeFoundationResolution(account,id,chainId);setCleared(true);}};
      return <div className={styles.launchPage}><ModuleFoundationBuilder layout="studio" contextKey={'recovery:'+chainId}
        initialDraft={{name:'BRUNO',symbol:'BRUNO',initialBuy:'0'}}
        availability={{status:'ready',chainId,chainName:chainId===1?'Ethereum':'Robinhood Chain'}} catalog={catalog} quoteAssets={[quote]}
        submissionBlocked={pending&&!retryAvailable?'Previous transaction needs checking':undefined}
        recoveryAction={!cleared?<RealSessionStatus inline session={session} editingNewLaunch/>:undefined}
        onUploadImage={async()=>{throw new Error('Disabled');}} onPrepareLaunch={async()=>{throw new Error('Fixture: no launch sent');}}
        onConfirmLaunch={async()=>{throw new Error('Fixture: no launch sent');}}/></div>;
    }
    function LaunchSpeedFixture() {
      const [context,setContext] = useState('wallet:'+chainId+':release');
      const [renders,setRenders] = useState(0);
      const warm = async (draft,signal) => {
        launchEvents.preparations++; launchEvents.startedAt=performance.now(); launchEvents.lastDraft=draft;
        signal.addEventListener('abort',()=>{launchEvents.aborts++;},{once:true});
        if(new URLSearchParams(location.search).has('holdPreparation')) await new Promise(resolve=>{window.finishFixturePreparation=resolve;});
        else await new Promise(resolve=>setTimeout(resolve,1200));
        signal.throwIfAborted();
        launchEvents.readyAt=performance.now();
        return {id:String(launchEvents.preparations),contextKey:context,expiresAt:Math.floor(Date.now()/1000)+120,
          quote:{...quote,address:draft.quoteAsset},chainId,platformFeeBps:30,platformFeeRecipient:FOUNDATION_PLATFORM_FEE_RECIPIENT,creatorFeeBps:draft.creatorFeeBps,
          transactions:[{label:'Launch coin',to:quote.address,chainId,value:'0',effect:'Launch coin'}]};
      };
      return <><button data-testid="wallet-switch" onClick={()=>setContext('other-wallet:'+chainId+':release')}>Fixture wallet switch</button>
        <button data-testid="rerender" onClick={()=>setRenders(value=>value+1)}>Fixture render {renders}</button>
        <ModuleFoundationBuilder layout="studio" availability={{status:'ready',chainId,chainName:chainId===1?'Ethereum':'Robinhood Chain'}}
          contextKey={context} catalog={catalog} quoteAssets={[quote]} suggestedInitialBuy="0.001" minimumInitialBuy="0.0008"
          walletAction={new URLSearchParams(location.search).get('mode')==='wallet-recovery' && context==='wallet:4663:release'
            ? {label:'Switch to Ethereum',onClick:async()=>{throw new Error('Network change cancelled.');}} : undefined}
          onResolveQuote={new URLSearchParams(location.search).get('mode')==='open-quote' ? async address=>({address,chainId:4663,name:'Pair token',symbol:'PAIR',decimals:6,supported:true}) : undefined}
          onUploadImage={async ({image})=>({url:'https://k2uoipt9wchjtz3h.public.blob.vercel-storage.com/token-images/'+'aa'.repeat(32)+'.webp',sha256:image.sha256})}
          onWarmLaunch={warm} onPrepareLaunch={async draft=>{launchEvents.coldPreparations++;return warm(draft,new AbortController().signal);}}
          onConfirmLaunch={async review=>{launchEvents.walletRequests++;launchEvents.walletRequestedAt=performance.now();launchEvents.walletContext=review.contextKey;
            if(new URLSearchParams(location.search).has('holdWallet')) await new Promise(resolve=>{window.rejectFixtureWallet=resolve;});
            throw Object.assign(new Error('Fixture wallet rejected. No transaction was sent.'),{walletRequestAttempted:false});}}/>
      </>;
    }
    function App() {
      const mode = new URLSearchParams(location.search).get('mode');
      const [draft,setDraft] = useState({name:'',symbol:'COIN',description:'',image:null,socialLinks:{},quoteAsset:'',
        creatorFeeBps:mode==='fees'?1100:0,initialBuy:'0.001',additionalLiquidity:'0',modules:[]});
      const [customQuote,setCustomQuote] = useState(false);
      const [errors,setErrors] = useState(new URLSearchParams(location.search).get('mode')==='error'?{name:'Enter a coin name'}:{});
      const imageInput = useRef(null);
      if(mode==='pending-recovery') return <PendingRecoveryFixture/>;
      if(mode==='draft-navigation') return <DraftNavigationFixture/>;
      if(mode==='launch-speed'||mode==='open-quote'||mode==='wallet-recovery'||mode==='availability') return <LaunchSpeedFixture/>;
      if(mode==='restored-launch') return <ModuleFoundationLaunchHost layout="studio"/>;
      return <div className="app-frame"><SiteHeader/><main><div className={styles.launchPage}>
        <FoundationStudio draft={draft} catalog={catalog} quoteSymbol={customQuote?'TOKEN':'ETH'} initialBuy={draft.initialBuy}
          actionLabel="Review coin" errors={errors} customQuote={customQuote} canResolveQuote imageInput={imageInput}
          onUpdate={(key,value)=>{setDraft(current=>({...current,[key]:value}));setErrors({});}}
          onQuoteChange={address=>{setCustomQuote(true);setDraft(current=>({...current,quoteAsset:address}));}}
          onEnableQuote={()=>setCustomQuote(true)}
          onDefaultQuote={()=>{setCustomQuote(false);setDraft(current=>({...current,quoteAsset:''}));}}
          onChooseImage={()=>{}} onRemoveImage={()=>{}}
          onSubmit={event=>{event.preventDefault();setErrors(mode==='fees'&&draft.creatorFeeBps>1000?{creatorFeeBps:'Choose a whole percentage from 0% to 10%.'}:draft.name?{}:{name:'Enter a coin name'});}}/>
      </div></main></div>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const bundled = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: root }, bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/fixture-output", jsx: "automatic", external: ["/fonts/*", "/brand/*"],
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "module-studio-boundaries", setup(plugin) {
      plugin.onResolve({ filter: /^(@\/components\/(wallet-provider|module-foundation-session)|\.\/module-foundation-session|next\/(navigation|link|image))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root,
        contents: args.path.endsWith("module-foundation-session") ? `const account='0x'+'aa'.repeat(20); const resolution={status:'success',operationId:'previous',account,metadata:{stepKind:'launch',operationKind:'launch',token:'0x'+'bb'.repeat(20)},transactionHash:'0x'+'cc'.repeat(32)};
          const session={account,contextKey:'restored',resultGeneration:0,client:{},pending:'null',resolution,progress:'',walletContext:{},envelope:null,displayEnvelope:null,availability:{status:'ready',chainId:4663,chainName:'Robinhood Chain'}};
          export const useFoundationSession=()=>session; export const FoundationSessionStatus=()=>null;`
          : args.path === "@/components/wallet-provider" ? `export const useWallet=()=>({wallet:null,authenticated:false,walletLinked:false,authReady:true,sessionReady:true,hasSession:false,openingWallet:false,connecting:false,disconnecting:false,preloadWallet:()=>{},openWallet:()=>{},disconnect:async()=>false});`
          : args.path === "next/navigation" ? `export const usePathname=()=>'/launch/modules/foundation';export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({prefetch:()=>{},push:()=>{},replace:()=>{}});`
          : args.path === "next/link" ? `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`
          : `import React from 'react';export default function Image({priority,fill,unoptimized,...props}){if(props.src?.startsWith('https://programmable.market/brand/')) props.src=new URL(props.src).pathname; return <img {...props}/>}` }));
    } }],
  });
  const files = new Map(bundled.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (files.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(files.get(url.pathname)); return; }
    if (/^\/webp_enc(?:_simd)?\.wasm$/.test(url.pathname)) {
      response.setHeader("Content-Type", "application/wasm");
      response.end(await readFile(resolve(root, "node_modules/@jsquash/webp/codec/enc", url.pathname.slice(1)))); return;
    }
    if (url.pathname.startsWith("/api/")) { response.writeHead(403); response.end("Financial actions disabled in this fixture"); return; }
    if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) {
      const base = resolve(root, "public"), file = resolve(base, "." + url.pathname);
      if (!file.startsWith(base + sep)) { response.writeHead(404); response.end(); return; }
      const types = { ".woff2": "font/woff2", ".png": "image/png", ".avif": "image/avif", ".webp": "image/webp", ".svg": "image/svg+xml" };
      try { response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream"); response.end(await readFile(file)); }
      catch { response.writeHead(404); response.end(); } return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Local Module Studio fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
