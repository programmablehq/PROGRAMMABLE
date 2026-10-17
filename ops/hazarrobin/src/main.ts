import '@fontsource-variable/geist';
import './styles.css';
import { formatUnits, type Address } from 'viem';
import { readSnapshot, claimFees, type ChainSnapshot, type WalletConnection } from './chain';
import { FEE_RECIPIENT, TOKEN_ID, LOCKER, CLAIM_CALLDATA } from './config';
import { scanChain, connect, totals, claimEcosystem, eligible, pending, pendingClaims, checkPending, remember, walletRequestNotSent, type Scan } from './ecosystem';

type GroupId='v4'|'robinhood'|'ethereum';
interface Group {id:GroupId;title:string;description:string;network:string;chainId:1|4663;busy:boolean;message:string;error:string;scan?:Scan;snapshot?:ChainSnapshot}
const groups:Group[]=[
 {id:'v4',title:'Programmable V4',description:'LP-Gebühren unseres V4-Coins',network:'Robinhood',chainId:4663,busy:false,message:'Noch nicht gescannt',error:''},
 {id:'robinhood',title:'Robinhood Ecosystem',description:'Module Mode und Custom Launches',network:'Robinhood',chainId:4663,busy:false,message:'Noch nicht gescannt',error:''},
 {id:'ethereum',title:'Ethereum Ecosystem',description:'Module Mode und Custom Launches',network:'Ethereum',chainId:1,busy:false,message:'Noch nicht gescannt',error:''},
];
let wallet:WalletConnection|null=null,claiming=false,notice='';
const app=document.querySelector<HTMLDivElement>('#app')!;
const escape=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const short=(s:string)=>`${s.slice(0,6)}…${s.slice(-4)}`;
function amount(raw:bigint,decimals=18){if(raw===0n)return '0';const value=formatUnits(raw,decimals),[whole,fraction='']=value.split('.');if(whole==='0'&&fraction.search(/[1-9]/)>=6)return '< 0.000001';return whole+(fraction?'.'+fraction.slice(0,6).replace(/0+$/,''):'').replace(/\.$/,'');}
function values(g:Group){return g.id==='v4'?(g.snapshot?[{symbol:'ETH',decimals:18,amount:g.snapshot.claimableEth},{symbol:'V4',decimals:18,amount:g.snapshot.claimableV4}]:[]):g.scan?(g.scan.claims.length?totals(g.scan.claims):[{symbol:'ETH',decimals:18,amount:0n}]):[];}
function positive(g:Group){return values(g).some(v=>v.amount>0n);}
function canClaim(g:Group){return !g.busy&&!claiming&&positive(g)&&(g.id==='v4'?g.snapshot?.trusted:!wallet||!!eligible(g.scan!.claims,wallet.account).length);}
function recipients(g:Group){return g.id==='v4'?[FEE_RECIPIENT]:[...new Set(g.scan?.claims.map(c=>c.recipient)??[])];}
function explorer(g:Group){return g.chainId===1?'https://etherscan.io':'https://robinhoodchain.blockscout.com';}
function card(g:Group,index:number){
 const v=values(g),loaded=g.id==='v4'?!!g.snapshot:!!g.scan;
 const incomplete=g.scan&&!g.scan.complete;
 const status=g.busy?'scan':g.error||incomplete?'partial':loaded?'ready':'idle';
 const statusText=g.busy?'Scan läuft':g.error?'Erneut prüfen':incomplete?(g.scan?.blockedClaims?.length&&!g.scan.issues.length&&!g.scan.unsupported.length?'Fees verfügbar':'Teilweise geprüft'):loaded?'Geprüft':'Bereit zum Scan';
 return `<section class="card ${status}" aria-labelledby="title-${g.id}"><div class="card-top"><span class="number">0${index+1}</span><span class="network">${g.network}</span></div>
 <h2 id="title-${g.id}">${g.title}</h2><p class="description">${g.description}</p>
 <div class="amounts">${v.length?v.filter(x=>x.amount>0n||v.every(y=>y.amount===0n)).map(x=>`<div class="amount"><strong>${amount(x.amount,x.decimals)}</strong><span>${escape(x.symbol)}</span></div>`).join(''):'<div class="amount empty"><strong>—</strong><span>Gebühren</span></div>'}</div>
 <div class="status-line"><span class="dot"></span><span>${statusText}</span></div>
 <p class="progress" aria-live="polite">${escape(g.error||g.message)}</p>
 <button class="claim primary" data-claim="${g.id}" ${canClaim(g)?'':'disabled'}>${claiming&&g.busy?'Wird geclaimt…':g.busy?'Wird gescannt…':loaded&&!positive(g)?'Keine offenen Fees':'Fees claimen'}<span aria-hidden="true">↗</span></button>
 <button class="secondary scan-one" data-scan="${g.id}" ${g.busy||claiming?'disabled':''}>Neu scannen</button>
 ${loaded?`<details><summary>Details ansehen</summary><div class="details-body">
 ${g.id==='v4'?`<p>V4 LP-Position ${TOKEN_ID}. Es werden nur Gebühren ausgezahlt; die Liquidität bleibt gesperrt.</p>`:`<p>${g.scan!.launchCount} Launches geprüft · ${g.scan!.claims.length} offene Gebührenkonten</p>`}
 ${recipients(g).map(r=>`<div class="recipient"><span>Empfänger</span><a href="${explorer(g)}/address/${r}" target="_blank" rel="noreferrer">${short(r)}</a></div>`).join('')}
 ${g.scan?.claims.some(c=>!c.permissionless)?'<p>Einige ältere Verträge benötigen die jeweilige Empfänger-Wallet zum Claimen.</p>':''}
 ${g.scan?.issues.map(i=>`<p class="warning">${escape(i.source)}: ${escape(i.message)}</p>`).join('')??''}
 ${g.scan?.blockedClaims?.length?`<p class="warning">${g.scan.blockedClaims.length} weitere Gebührenkonten sind derzeit nicht auszahlbar. Die übrigen Fees kannst du normal claimen.</p>${g.scan.blockedClaims.map(({claim:c,reason})=>`<p>${amount(BigInt(c.amount),c.decimals)} ${escape(c.symbol)} · ${escape(reason)}</p>`).join('')}`:''}
 ${g.scan?.unsupported.length?`<p class="warning">${g.scan.unsupported.length} Custom-Verträge benötigen einen zusätzlichen Claim-Adapter. Diese Ansprüche sind noch nicht als claimbar bestätigt.</p>`:''}
 ${g.scan?.claims.length?`<div class="claim-list">${g.scan.claims.map(c=>`<div><span>${escape(c.source)}</span><b>${amount(BigInt(c.amount),c.decimals)} ${escape(c.symbol)}</b><a href="${explorer(g)}/address/${c.to}" target="_blank" rel="noreferrer">${short(c.to)}</a></div>`).join('')}</div>`:''}
 </div></details>`:''}</section>`;
}
function render(){
 app.innerHTML=`<header><a class="brand" href="https://programmable.market" target="_blank" rel="noreferrer"><img src="/programmable.png" alt=""/><span>programmable<span class="brand-sub">fee claims</span></span></a><button class="wallet" id="connect" ${claiming?'disabled':''}><span class="wallet-dot ${wallet?'connected':''}"></span>${wallet?short(wallet.account):'Wallet verbinden'}</button></header>
 <main><div class="hero"><span class="eyebrow">HAZARROBIN</span><h1>Alle Fees.<br><span>Drei Claims.</span></h1><p>Scanne die Gebühren unseres Coins und beider Ecosystems.<br>ETH und Token werden an die hinterlegten Wallets ausgezahlt.</p><div class="hero-actions"><button id="scan-all" class="primary" ${groups.some(g=>g.busy)||claiming?'disabled':''}>${groups.some(g=>g.busy)&&!claiming?'Scan läuft…':'Alles scannen'}<span aria-hidden="true">↻</span></button><button id="claim-all" class="outline" ${!groups.some(canClaim)||groups.some(g=>g.busy)||claiming?'disabled':''}>Alles claimen <span aria-hidden="true">↗</span></button></div></div>
 <div id="notice" class="notice ${notice?'visible':''}" role="status">${escape(notice)}</div>
 ${pendingClaims().map(p=>`<div class="pending">${p.chainId===1?'Ethereum':'Robinhood'}: Vorherigen Auftrag prüfen. ${p.hash?`<a href="${p.chainId===1?'https://etherscan.io':'https://robinhoodchain.blockscout.com'}/tx/${p.hash}" target="_blank" rel="noreferrer">Transaktion ansehen</a> · `:''}<button data-pending="${p.chainId}">Status prüfen</button></div>`).join('')}
 <div class="grid">${groups.map(card).join('')}</div>
 <p class="footnote">Kein Mindestbetrag. Keine Freigabe deiner Token. Pro Chain bestätigst du die Auszahlung in deiner Wallet.</p>
 </main><footer><span>Programmable Treasury</span><div><a href="/privacy.html">Datenschutz</a><a href="/terms.html">Hinweise</a></div></footer>`;
 document.querySelector('#connect')?.addEventListener('click',()=>void connectWallet());
 document.querySelector('#scan-all')?.addEventListener('click',()=>void scanAll());
 document.querySelector('#claim-all')?.addEventListener('click',()=>void claimAll());
 document.querySelectorAll<HTMLElement>('[data-pending]').forEach(el=>el.addEventListener('click',()=>void recover(Number(el.dataset.pending) as 1|4663)));
 document.querySelectorAll<HTMLElement>('[data-scan]').forEach(el=>el.addEventListener('click',()=>void scanGroup(groups.find(g=>g.id===el.dataset.scan)!)));
 document.querySelectorAll<HTMLElement>('[data-claim]').forEach(el=>el.addEventListener('click',()=>void claimGroup(groups.find(g=>g.id===el.dataset.claim)!)));
}
const message=(error:unknown)=>error instanceof Error?(('shortMessage' in error?String(error.shortMessage):error.message).slice(0,260)):'Bitte erneut versuchen.';
async function connectWallet(){try{wallet=await connect();notice='Wallet verbunden.';}catch(e){notice=message(e);}render();}
async function scanGroup(g:Group){if(g.busy||claiming)return;g.busy=true;g.error='';g.message='Gebühren werden geprüft…';render();try{
 if(g.id==='v4'){g.snapshot=await readSnapshot();if(!g.snapshot.trusted)throw Error('LP-Vertragsprüfung fehlgeschlagen. Auszahlung pausiert.');g.message='LP-Gebühren live gelesen.';}
 else{g.scan=await scanChain(g.chainId,s=>{g.message=s;render();});g.message=g.scan.complete?'Alle unterstützten Quellen geprüft.':g.scan.issues.length?'Ein Teil der Quellen ist noch nicht erreichbar.':'Verfügbare Fees bereit. Weitere Informationen siehe Details.';}
 }catch(e){g.error=message(e);}finally{g.busy=false;render();}}
async function scanAll(){notice='';await Promise.all(groups.map(scanGroup));}
async function recover(chainId:1|4663){if(claiming)return;claiming=true;try{await checkPending(s=>{notice=s;render();},chainId);}catch(e){notice=message(e);}finally{claiming=false;render();}if(!pending(chainId))await Promise.all(groups.filter(g=>g.chainId===chainId).map(scanGroup));}
async function claimGroup(g:Group){if(claiming)return;if(!wallet){await connectWallet();if(!wallet)return;}
 if(g.id!=='v4'&&(!g.scan||Date.now()-g.scan.scannedAt>90000)){await scanGroup(g);if(!g.scan)return;}
 claiming=true;g.busy=true;g.error='';notice='';render();
 try{
 if(pending(g.chainId))await checkPending(s=>{notice=s;render();},g.chainId);
 if(g.id==='v4'){
 let nonce=0;
 await claimFees(wallet,p=>{if(p.nonce!==undefined)nonce=p.nonce;g.message=p.stage==='wallet'?'In der Wallet bestätigen…':p.stage==='confirmed'?'Claim bestätigt.':'Auf Bestätigung warten…';if(p.stage==='wallet')remember({chainId:4663,account:wallet!.account,to:LOCKER,data:CLAIM_CALLDATA,nonce,created:Date.now()});if(p.hash)remember({chainId:4663,account:wallet!.account,to:LOCKER,data:CLAIM_CALLDATA,nonce,created:Date.now(),hash:p.hash});render();});remember(null,g.chainId);
 }else{const result=await claimEcosystem(g.scan!,wallet,s=>{g.message=s;render();});if(result.remaining)notice=`${result.count} Gebührenkonten ausgezahlt. Für ${result.remaining} weitere Konten bitte die Empfänger-Wallet verbinden.`;}
 g.message='Auszahlung bestätigt.';if(!notice)notice=`${g.title}: Fees ausgezahlt.`;
 }catch(e){if(walletRequestNotSent(e))remember(null,g.chainId);g.error=message(e);notice=g.error;}
 finally{g.busy=false;claiming=false;render();}
 if(!g.error)await scanGroup(g);
}
async function claimAll(){const blocked=new Set<number>();for(const g of groups){if(!blocked.has(g.chainId)&&canClaim(g)){await claimGroup(g);if(g.error||pending(g.chainId))blocked.add(g.chainId);}}}
window.ethereum?.on?.('accountsChanged',()=>{wallet=null;notice='Wallet gewechselt. Bitte erneut verbinden.';render();});
render();void scanAll();
