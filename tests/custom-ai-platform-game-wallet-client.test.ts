import {beforeEach,it,expect,vi} from "vitest";
import {privateKeyToAccount} from "viem/accounts";
import {encodeFunctionData,type Abi,type Hex} from "viem";
import {performGameWalletRequest,serializeGameWalletTypedData,type GameWalletRuntime,type GameWalletRequest} from "../lib/custom-ai/platform/game-wallet-client";
import {walletLinkTypedData,gameEventTypedData,type GameBinding,type WalletLinkInvitation} from "../lib/custom-ai/platform/game-events";
import type {LaunchStep} from "../lib/custom-ai/launch-session";
import receiverCode from "../lib/custom-ai/platform/game-events-code.json";
const receiverABI=receiverCode.artifacts.ProjectPlayerGameEventsV1.abi as Abi;
const issuer=privateKeyToAccount(`0x${"11".repeat(32)}`),player=privateKeyToAccount(`0x${"22".repeat(32)}`),now=1800000000,hash=`0x${"ab".repeat(32)}` as Hex;
const binding:GameBinding={id:`0x${"33".repeat(32)}`,revisionId:`sha256:${"44".repeat(32)}`,gameId:"maze",chainId:4663,target:`0x${"55".repeat(20)}`,runtimeHash:`0x${"66".repeat(32)}`,issuer:issuer.address,maxAge:300,maximumScore:"1"};
let invitation:WalletLinkInvitation,step:LaunchStep;
beforeEach(async()=>{
 const link={player:player.address,playerIdHash:`0x${"77".repeat(32)}` as Hex,nonce:`0x${"88".repeat(32)}` as Hex,validUntil:now+120};invitation={...link,issuerSignature:await issuer.signTypedData(walletLinkTypedData(binding,link))};
 const signature=await player.signTypedData(walletLinkTypedData(binding,link));
 step={id:"prepared-step",kind:"program-action",state:"prepared",expiresAt:now+120,preparedBlock:"100",transaction:{from:player.address,to:binding.target,chainId:4663,value:"0x0",nonce:"0x1",gas:"0x100000",data:encodeFunctionData({abi:receiverABI,functionName:"bindPlayer",args:[link.player,link.playerIdHash,link.nonce,BigInt(link.validUntil),signature,invitation.issuerSignature]})}};
});
function fixture(){
 const values=new Map<string,string>(),order:string[]=[];let current=true;
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);order.push("stored:"+JSON.parse(value).state);},removeItem:(key:string)=>{values.delete(key)}};
 const sign=vi.fn(async(data:ReturnType<typeof walletLinkTypedData>)=>player.signTypedData(data)),send=vi.fn(async()=>{order.push("wallet");return hash;});
 const api=vi.fn(async(body:Record<string,unknown>)=>{
  order.push(String(body.action));
  if(body.action==="review-link")return {binding,invitation};
  if(body.action==="dispatch-wallet")return {step:{...step,state:"dispatching"},dispatchId:body.dispatchId};
  return {};
 });
 const runtime:GameWalletRuntime={ownerId:"owner-one",account:player.address,now:()=>now,randomId:()=>"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",storage,assertCurrent:()=>{if(!current)throw Error("Session changed")},assertAuthority:async()=>{},run:async(_key,work)=>work(),sign,send};
 const request={kind:"send" as const,ownerId:"owner-one",projectId:"11111111-1111-4111-8111-111111111111",revisionId:binding.revisionId,binding,action:{kind:"wallet-link" as const,requestId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",player:player.address,playerIdHash:invitation.playerIdHash},step,api,assertCurrent:()=>runtime.assertCurrent()} as GameWalletRequest;
 return {runtime,request,api,send,sign,values,order,changeSession:()=>{current=false}};
}
it("sends the complete EIP-712 domain definition to raw wallet RPC",()=>{
 const payload=JSON.parse(serializeGameWalletTypedData(walletLinkTypedData(binding,invitation)));
 expect(payload.types.EIP712Domain).toEqual([{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}]);
 expect(BigInt(payload.domain.chainId)).toBe(4663n);expect(payload.domain.verifyingContract.toLowerCase()).toBe(binding.target.toLowerCase());expect(payload.primaryType).toBe("WalletLink");
});
it("verifies the issuer and current receiver before signing the exact player agreement",async()=>{
 const f=fixture();const request={...f.request,kind:"sign-link" as const,invitation} as GameWalletRequest;
 const result=await performGameWalletRequest(request,f.runtime);expect(result.kind).toBe("signed-link");expect(f.sign).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();
});
it("rejects a changed issuer proof or current binding before requesting a signature",async()=>{
 const f=fixture();f.api.mockResolvedValueOnce({binding:{...binding,id:`0x${"99".repeat(32)}`},invitation});
 await expect(performGameWalletRequest({...f.request,kind:"sign-link",invitation} as GameWalletRequest,f.runtime)).rejects.toBeDefined();expect(f.sign).not.toHaveBeenCalled();
});
it("accepts the same verified invitation when JSON key order changes",async()=>{
 const f=fixture();f.api.mockResolvedValueOnce({binding,invitation:{issuerSignature:invitation.issuerSignature,validUntil:invitation.validUntil,nonce:invitation.nonce,playerIdHash:invitation.playerIdHash,player:invitation.player}});
 expect(await performGameWalletRequest({...f.request,kind:"sign-link",invitation} as GameWalletRequest,f.runtime)).toMatchObject({kind:"signed-link"});
});
it("stores the transaction hash before notifying the API and never repeats an acknowledged send",async()=>{
 const f=fixture();const first=await performGameWalletRequest(f.request,f.runtime);expect(first).toMatchObject({kind:"submitted",hash,acknowledged:true});
 expect(f.order.indexOf("stored:submitted")).toBeLessThan(f.order.indexOf("wallet-submitted"));
 await performGameWalletRequest(f.request,f.runtime);expect(f.send).toHaveBeenCalledOnce();
});
it("keeps one recovery record when an address changes checksum casing",async()=>{
 const f=fixture();await performGameWalletRequest(f.request,f.runtime);
 const request=f.request as Extract<GameWalletRequest,{kind:"send"}>;
 await performGameWalletRequest({...request,action:{...request.action,player:request.action.player.toLowerCase() as Hex}},f.runtime);expect(f.send).toHaveBeenCalledOnce();expect(f.values.size).toBe(1);
});
it("retries a lost dispatch acknowledgement with the same persisted identity before any wallet call",async()=>{
 const f=fixture();f.api.mockRejectedValueOnce(Error("Lost HTTP response"));
 await expect(performGameWalletRequest(f.request,f.runtime)).rejects.toBeDefined();expect(f.send).not.toHaveBeenCalled();
 const dispatchId=(f.api.mock.calls[0][0] as Record<string,unknown>).dispatchId;
 await performGameWalletRequest(f.request,f.runtime);expect(f.api.mock.calls[1][0]).toMatchObject({dispatchId});expect(f.send).toHaveBeenCalledOnce();
});
it("can cancel a known unsent preparation but not an uncertain wallet send",async()=>{
 const f=fixture();f.api.mockRejectedValueOnce(Error("Lost reservation response"));await expect(performGameWalletRequest(f.request,f.runtime)).rejects.toBeDefined();
 expect(await performGameWalletRequest({...f.request,kind:"cancel"} as GameWalletRequest,f.runtime)).toMatchObject({kind:"cancelled"});expect(f.values.size).toBe(0);expect(f.send).not.toHaveBeenCalled();
 const unknown=fixture();unknown.send.mockRejectedValue(Error("Lost wallet response"));await expect(performGameWalletRequest(unknown.request,unknown.runtime)).rejects.toBeDefined();
 await expect(performGameWalletRequest({...unknown.request,kind:"cancel"} as GameWalletRequest,unknown.runtime)).rejects.toMatchObject({code:"game-wallet-pending"});
});
it("retains an uncertain native wallet request across another click or reload",async()=>{
 const f=fixture();f.send.mockRejectedValue(Error("Disconnected after send"));
 await expect(performGameWalletRequest(f.request,f.runtime)).rejects.toMatchObject({code:"game-wallet-pending"});
 await expect(performGameWalletRequest(f.request,{...f.runtime})).rejects.toMatchObject({code:"game-wallet-pending"});
 expect(f.send).toHaveBeenCalledOnce();expect(f.api.mock.calls.some(([body])=>body.action==="wallet-rejected")).toBe(false);
});
it("releases only an explicit wallet rejection",async()=>{
 const f=fixture();f.send.mockRejectedValue(Object.assign(Error("Rejected"),{code:4001}));
 await expect(performGameWalletRequest(f.request,f.runtime)).rejects.toBeDefined();expect(f.api.mock.calls.some(([body])=>body.action==="wallet-rejected")).toBe(true);expect(JSON.parse([...f.values.values()][0]).state).toBe("rejected");
});
it("returns and retains the actual hash when API notification fails",async()=>{
 const f=fixture();f.api.mockImplementation(async body=>{if(body.action==="dispatch-wallet")return {step,dispatchId:body.dispatchId};throw Error("Notification lost")});
 expect(await performGameWalletRequest(f.request,f.runtime)).toMatchObject({kind:"submitted",hash,acknowledged:false});
 expect(JSON.parse([...f.values.values()][0]).hash).toBe(hash);await performGameWalletRequest(f.request,f.runtime);expect(f.send).toHaveBeenCalledOnce();
});
it("replaces a superseded preparing journal only after reading the server's unsent current step",async()=>{
 const f=fixture(),event={eventId:`0x${"ce".repeat(32)}` as Hex,playerIdHash:invitation.playerIdHash,player:player.address,sequence:"1",score:"1",observedAt:now,validUntil:now+120};
 const signature=await issuer.signTypedData(gameEventTypedData(binding,event));
 const first={...step,transaction:{...step.transaction,data:encodeFunctionData({abi:receiverABI,functionName:"submitEvent",args:[{bindingId:binding.id,...event,sequence:1n,score:1n,observedAt:BigInt(now),validUntil:BigInt(now+120)},signature]})}};
 const request={...f.request,step:first,action:{kind:"event",eventId:event.eventId,player:player.address}} as GameWalletRequest;
 f.api.mockRejectedValueOnce(Error("Request never reached server"));await expect(performGameWalletRequest(request,f.runtime)).rejects.toBeDefined();
 const next={...first,id:"fresh-step",transaction:{...first.transaction,nonce:"0x2" as Hex}},readState=vi.fn(async()=>({events:[{id:event.eventId,bindingId:binding.id,state:"prepared",transactionHash:null,walletPending:false,step:next}]}));
 f.api.mockImplementation(async body=>body.action==="dispatch"?{step:next,dispatchId:body.dispatchId}:{});
 expect(await performGameWalletRequest({...request,step:next,readState} as GameWalletRequest,f.runtime)).toMatchObject({kind:"submitted",hash});
 expect(readState).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledOnce();expect(f.send.mock.calls[0]).toEqual([next.transaction]);
 const pending=fixture(),pendingRequest={...request,api:pending.api,assertCurrent:()=>pending.runtime.assertCurrent()};
 pending.api.mockRejectedValueOnce(Error("Lost HTTP response"));await expect(performGameWalletRequest(pendingRequest,pending.runtime)).rejects.toBeDefined();
 const pendingState=async()=>({events:[{id:event.eventId,bindingId:binding.id,state:"prepared",transactionHash:null,walletPending:true,step:next}]});
 await expect(performGameWalletRequest({...pendingRequest,step:next,readState:pendingState} as GameWalletRequest,pending.runtime)).rejects.toMatchObject({code:"game-wallet-pending"});expect(pending.send).not.toHaveBeenCalled();
});
it("does not start a wallet request if its recovery journal cannot be persisted",async()=>{
 const f=fixture();f.runtime.storage.setItem=()=>{throw Error("Storage is unavailable")};
 await expect(performGameWalletRequest(f.request,f.runtime)).rejects.toBeDefined();expect(f.send).not.toHaveBeenCalled();expect(f.api).not.toHaveBeenCalled();
});
it("retains the actual hash and blocks a second send if final local persistence fails",async()=>{
 const f=fixture(),save=f.runtime.storage.setItem;f.runtime.storage.setItem=(key,value)=>{if(JSON.parse(value).state==="submitted")throw Error("Storage is full");save(key,value)};
 expect(await performGameWalletRequest(f.request,f.runtime)).toMatchObject({kind:"submitted",hash,storedLocally:false,acknowledged:true});
 await expect(performGameWalletRequest(f.request,f.runtime)).rejects.toMatchObject({code:"game-wallet-pending"});expect(f.send).toHaveBeenCalledOnce();
});
it("rejects a transaction nonce that cannot be represented by the embedded wallet",async()=>{
 const f=fixture();const oversized={...step,transaction:{...step.transaction,nonce:"0x20000000000000" as Hex}};
 await expect(performGameWalletRequest({...f.request,step:oversized} as GameWalletRequest,f.runtime)).rejects.toBeDefined();expect(f.api).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
});
it("rejects another owner, destination, value or nonce before asking the wallet",async()=>{
 for(const patch of [{ownerId:"other-owner"},{step:{...step,transaction:{...step.transaction,to:issuer.address}}},{step:{...step,transaction:{...step.transaction,value:"0x1"}}}]){
  const f=fixture();await expect(performGameWalletRequest({...f.request,...patch} as GameWalletRequest,f.runtime)).rejects.toBeDefined();expect(f.send).not.toHaveBeenCalled();
 }
 const f=fixture();f.api.mockResolvedValueOnce({step:{...step,transaction:{...step.transaction,nonce:"0x2"}},dispatchId:f.runtime.randomId()});
 await expect(performGameWalletRequest(f.request,f.runtime)).rejects.toBeDefined();expect(f.send).not.toHaveBeenCalled();
});
it("rechecks the session after asynchronous authority checks",async()=>{
 const f=fixture();f.runtime.assertAuthority=async()=>{f.changeSession()};
 await expect(performGameWalletRequest(f.request,f.runtime)).rejects.toBeDefined();expect(f.send).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled();
});
it("accepts only the exact signed game result selected for this transaction",async()=>{
 const f=fixture(),event={eventId:`0x${"cc".repeat(32)}` as Hex,playerIdHash:invitation.playerIdHash,player:player.address,sequence:"1",score:"1",observedAt:now,validUntil:now+120};
 const signature=await issuer.signTypedData(gameEventTypedData(binding,event));
 const eventStep={...step,transaction:{...step.transaction,data:encodeFunctionData({abi:receiverABI,functionName:"submitEvent",args:[{bindingId:binding.id,...event,sequence:1n,score:1n,observedAt:BigInt(now),validUntil:BigInt(now+120)},signature]})}};
 f.api.mockImplementation(async body=>body.action==="dispatch"?{step:eventStep,dispatchId:body.dispatchId}:{});
 const request={...f.request,step:eventStep,action:{kind:"event",eventId:event.eventId,player:player.address}} as GameWalletRequest;
 expect(await performGameWalletRequest(request,f.runtime)).toMatchObject({kind:"submitted",hash});
 const other=fixture();await expect(performGameWalletRequest({...request,api:other.api,action:{kind:"event",eventId:`0x${"dd".repeat(32)}`,player:player.address}} as GameWalletRequest,other.runtime)).rejects.toBeDefined();expect(other.send).not.toHaveBeenCalled();
});
