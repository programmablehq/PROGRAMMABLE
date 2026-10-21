import { expect, it } from 'vitest';
import {runClaimQueue} from './claim-queue';
it('claims ready fees immediately, then continues with a slower chain without rescanning',async()=>{
 let release!:()=>void;let loading=true;const events:string[]=[];
 const wait=new Promise<void>(r=>{release=()=>{loading=false;r();}});
 const queue=runClaimQueue([{id:'eth',chain:1},{id:'rh',chain:4663}],{
  scanning:g=>g.id==='eth'&&loading,wait:()=>wait,eligible:()=>true,chain:g=>g.chain,
  claim:async g=>{events.push(g.id);},failed:()=>false,
 });
 await Promise.resolve();expect(events).toEqual(['rh']);
 release();await queue;expect(events).toEqual(['rh','eth']);
});
it('does not repeat a failed chain but still pays an independent chain',async()=>{
 const claims:number[]=[];
 await runClaimQueue([4663,4663,1],{scanning:()=>false,wait:async()=>{},eligible:()=>true,chain:g=>g,
 claim:async g=>{claims.push(g);},failed:g=>g===4663});
 expect(claims).toEqual([4663,1]);
});
it('ignores empty and unauthorized groups without asking the wallet',async()=>{
 const claims:number[]=[];
 await runClaimQueue([0,1,2],{scanning:()=>false,wait:async()=>{},eligible:g=>g===2,chain:g=>g,
 claim:async g=>{claims.push(g);},failed:()=>false});expect(claims).toEqual([2]);
});
