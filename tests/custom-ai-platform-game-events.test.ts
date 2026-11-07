import {describe,it,expect} from "vitest";
import {privateKeyToAccount} from "viem/accounts";
import {gameEventTypedData,verifyGameEvent,walletLinkTypedData,verifyWalletLink,type GameBinding,type GameEvent,type WalletLink,type SignedGameEvent} from "../lib/custom-ai/platform/game-events";
const issuer=privateKeyToAccount(`0x${"11".repeat(32)}`),player=privateKeyToAccount(`0x${"22".repeat(32)}`),now=1800000000;
const binding:GameBinding={id:`0x${"33".repeat(32)}`,revisionId:`sha256:${"44".repeat(32)}`,gameId:"reference-game",chainId:4663,target:`0x${"55".repeat(20)}`,runtimeHash:`0x${"66".repeat(32)}`,issuer:issuer.address,maxAge:300,maximumScore:"1000"};
const event:GameEvent={eventId:`0x${"77".repeat(32)}`,playerIdHash:`0x${"88".repeat(32)}`,player:player.address,sequence:"1",score:"10",observedAt:now,validUntil:now+120};
async function signed():Promise<SignedGameEvent>{return {...event,signature:await issuer.signTypedData(gameEventTypedData(binding,event))};}
describe("signed game events",()=>{
 it("verifies the declared issuer and exact event fields",async()=>{expect(await verifyGameEvent(binding,await signed(),now)).toMatchObject(event);});
 it("rejects stale, future, out-of-range and changed payloads",async()=>{
  const input=await signed();
  for(const patch of [{observedAt:now-301},{observedAt:now+1},{validUntil:now-1},{score:"1001"},{player:`0x${"99".repeat(20)}`}])await expect(verifyGameEvent(binding,{...input,...patch} as SignedGameEvent,now)).rejects.toBeDefined();
 });
 it("cannot replay an issuer signature on another chain, contract or binding",async()=>{
  const input=await signed();for(const patch of [{chainId:1 as const},{target:`0x${"99".repeat(20)}`},{id:`0x${"99".repeat(32)}`}])await expect(verifyGameEvent({...binding,...patch} as GameBinding,input,now)).rejects.toBeDefined();
 });
 it("requires the bound player's signature on a short-lived wallet link",async()=>{
  const proof:WalletLink={player:player.address,playerIdHash:event.playerIdHash,nonce:`0x${"aa".repeat(32)}`,validUntil:now+120};
  const signature=await player.signTypedData(walletLinkTypedData(binding,proof)),issuerSignature=await issuer.signTypedData(walletLinkTypedData(binding,proof));expect(await verifyWalletLink(binding,{...proof,signature,issuerSignature},now)).toMatchObject(proof);
  await expect(verifyWalletLink(binding,{...proof,signature,issuerSignature,player:issuer.address},now)).rejects.toBeDefined();
  await expect(verifyWalletLink(binding,{...proof,signature,issuerSignature},now+121)).rejects.toBeDefined();
  await expect(verifyWalletLink(binding,{...proof,signature,issuerSignature:signature},now)).rejects.toBeDefined();
 });
});
