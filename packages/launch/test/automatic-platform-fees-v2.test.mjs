import test from 'node:test';
import {assertEvmCapabilitiesResponse,validateLaunchRemote,submitLaunch} from '../src/api-client.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {canonicalizeJson} from '../src/canonical-json.mjs';
import {sha256Digest} from '../src/io.mjs';
import {withAutomaticNativeProfileV2,AUTOMATIC_NATIVE_TRADE_FEE_POLICIES_V2} from '../src/profile-v36.mjs';
import {validateEmbeddedDirectNativeProfile} from '../src/profile-direct-native-v1.mjs';
for(const [chain,name] of [['8453','base'],['999','hyperevm'],['99901','elysium']])test(name+' preserves the legacy profile and accepts the exact team-payout successor',async()=>{
 const old=JSON.parse(fs.readFileSync(new URL('../src/'+name+'-profile-v1.json',import.meta.url),'utf8'));
 const next=withAutomaticNativeProfileV2(old,AUTOMATIC_NATIVE_TRADE_FEE_POLICIES_V2[chain]);
 assert.deepEqual(validateEmbeddedDirectNativeProfile(old),old);
 assert.deepEqual(validateEmbeddedDirectNativeProfile(next),next);
 const prefix='/v4/chains/'+chain;
 const cap={schemaVersion:'programmable.custom-launch-capabilities.v1',apiVersion:'v4',chain:{id:chain,name:chain==='8453'?'Base':chain==='999'?'HyperEVM':'Elysium'},serverTime:'2026-11-16T12:00:00Z',releaseId:'sha256:'+'ab'.repeat(32),mode:'active',publicLaunchAuthorized:true,moduleMode:false,
  routes:{create:prefix+'/custom-launches',list:prefix+'/custom-launches',status:prefix+'/custom-launches/{launchId}',preflight:prefix+'/custom-launches/preflight',capabilities:prefix+'/capabilities',readiness:prefix+'/readiness',finalizedMetadata:prefix+'/finalized-custom-launches'},authentication:{create:'bearer-api-key',requiredScopes:['custom-launch:create','custom-launch:read']},profile:old};
 assert.doesNotThrow(()=>assertEvmCapabilitiesResponse(cap,chain));
 const automatic={policyId:'programmable.automatic-platform-fees.v2',status:'active',chainId:chain,teamWallet:'0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62',platformFeeBps:30,buybackBps:0,nativePayoutBps:10000,activationTime:'2026-11-16T12:00:00Z',router:null};
 assert.doesNotThrow(()=>assertEvmCapabilitiesResponse({...cap,profile:next,automaticPlatformFees:automatic},chain));
 assert.throws(()=>assertEvmCapabilitiesResponse({...cap,profile:next,automaticPlatformFees:{...automatic,teamWallet:old.router}},chain));
 const bad=structuredClone(next);bad.programmableTradeFeePolicy.defaultCollection.recipient='0x1111111111111111111111111111111111111111';
 assert.throws(()=>validateEmbeddedDirectNativeProfile(bad));
 const stateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'fee-profile-recovery-'));
 try{
  for(const operation of [validateLaunchRemote,submitLaunch]){
   let posts=0;
   const request={schemaVersion:'programmable.custom-launch-create-request.v3',chainId:chain,launchProfile:old};
   const bytes=Buffer.from(canonicalizeJson(request));
   await assert.rejects(operation({launchPath:'unused.json',configPath:'unused-config.json',stateDirectory,maxAttempts:1,
    validateLaunchFileImpl:async()=>({schemaVersion:request.schemaVersion,requestSha256:sha256Digest(bytes)}),readLaunchBytesImpl:async()=>bytes,
    loadApiKeyImpl:async()=>'fixture-credential',fetchImpl:async(_url,init)=>{
     if(init.method==='GET')return new Response(JSON.stringify({...cap,profile:next,automaticPlatformFees:automatic}));
     posts++;assert.deepEqual(Buffer.from(init.body),bytes);
     return new Response(JSON.stringify({error:{code:'PROFILE_INVALID',message:'Historical approval required'}}),{status:400});
    }}));
   assert.equal(posts,1,'canonical historical bytes reach the server-owned approval check');
  }
 }finally{fs.rmSync(stateDirectory,{recursive:true,force:true});}
});
