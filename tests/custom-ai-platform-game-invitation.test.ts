import {describe,it,expect,vi} from "vitest";
import {privateKeyToAccount} from "viem/accounts";
import {keccak256,type Hex} from "viem";
vi.mock("server-only",()=>({}));
import {verifyWalletInvitation,walletLinkTypedData,type GameBinding} from "../lib/custom-ai/platform/game-events";
import {createGameEventService} from "../lib/custom-ai/platform/event-chain.server";
import type {createGameEventStore} from "../lib/custom-ai/platform/event-store.server";
import type {CustomAIChain} from "../lib/custom-ai/chain.server";
import code from "../lib/custom-ai/platform/game-events-code.json";
const issuer=privateKeyToAccount(`0x${"11".repeat(32)}`),player=privateKeyToAccount(`0x${"22".repeat(32)}`),now=1800000000;
const runtime=code.artifacts.ProjectPlayerGameEventsV1.runtimeTemplate as Hex;
const binding:GameBinding={id:`0x${"33".repeat(32)}`,revisionId:`sha256:${"44".repeat(32)}`,gameId:"reference-game",chainId:4663,target:`0x${"55".repeat(20)}`,runtimeHash:keccak256(runtime),issuer:issuer.address,maxAge:300,maximumScore:"1000"};
const scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"};
const link={player:player.address,playerIdHash:`0x${"88".repeat(32)}` as Hex,nonce:`0x${"aa".repeat(32)}` as Hex,validUntil:now+120};
const invitation=async()=>({...link,issuerSignature:await issuer.signTypedData(walletLinkTypedData(binding,link))});
function service(options:{runtime?:Hex;onchainId?:Hex}={}){
 const finish=vi.fn(async()=>{}),read=vi.fn(async()=>({binding,version:"v1"}));
 const store={currentBinding:read} as unknown as ReturnType<typeof createGameEventStore>;
 const chain={chainId:4663,block:{timestamp:String(now)},code:vi.fn(async()=>options.runtime??runtime),finish,call:vi.fn(async(_target:string,fn:string)=>fn.includes("bindingId")?options.onchainId??binding.id:fn.includes("issuer")?issuer.address:fn.includes("maxAge")?300n:1000n)} as unknown as CustomAIChain;
 return {service:createGameEventService(store,async()=>chain),chain,finish,read};
}
describe("game invitation review before requesting a player signature",()=>{
 it("verifies the issuer without requiring or creating a player signature",async()=>{
  expect(await verifyWalletInvitation(binding,await invitation(),now)).toMatchObject(link);
 });
 it("rejects expired invitations, extra fields and altered domain or player",async()=>{
  const proof=await invitation();
  for(const input of [{...proof,validUntil:now-1},{...proof,player:issuer.address},{...proof,privateKey:"not allowed"}])await expect(verifyWalletInvitation(binding,input,now)).rejects.toBeDefined();
  for(const changed of [{...binding,chainId:1 as const},{...binding,target:issuer.address},{...binding,id:`0x${"99".repeat(32)}` as Hex}])await expect(verifyWalletInvitation(changed,proof,now)).rejects.toBeDefined();
 });
 it("checks the current saved binding and deployed receiver before returning a review",async()=>{
  const f=service(),proof=await invitation();
  expect(await f.service.reviewWalletLink(scope,binding.id,proof,player.address,[player.address])).toEqual({binding,invitation:proof});
  expect(f.read).toHaveBeenCalledWith(scope,binding.id);expect(f.finish).toHaveBeenCalledOnce();
 });
 it("rejects a different or unlinked player before asking for any signature",async()=>{
  const f=service(),proof=await invitation();
  await expect(f.service.reviewWalletLink(scope,binding.id,proof,issuer.address,[issuer.address])).rejects.toMatchObject({code:"game-wallet"});
  await expect(f.service.reviewWalletLink(scope,binding.id,proof,player.address,[])).rejects.toMatchObject({code:"game-wallet"});
 });
 it("previews the actual canonical receiver hash and refuses changed onchain bindings",async()=>{
  const f=service();expect(await f.service.previewBinding(binding)).toEqual({binding,verified:true,registered:false});
  await expect(service({runtime:"0x1234"}).service.previewBinding(binding)).rejects.toMatchObject({code:"game-code"});
  await expect(service({onchainId:`0x${"99".repeat(32)}`}).service.previewBinding(binding)).rejects.toMatchObject({code:"game-binding"});
 });
});
