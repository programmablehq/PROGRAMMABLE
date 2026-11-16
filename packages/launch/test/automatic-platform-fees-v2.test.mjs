import test from 'node:test';
import {assertEvmCapabilitiesResponse} from '../src/api-client.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withAutomaticNativeProfileV2,AUTOMATIC_NATIVE_TRADE_FEE_POLICIES_V2} from '../src/profile-v36.mjs';
import {validateEmbeddedDirectNativeProfile} from '../src/profile-direct-native-v1.mjs';
for(const [chain,name] of [['8453','base'],['999','hyperevm'],['99901','elysium']])test(name+' preserves the legacy profile and accepts the exact team-payout successor',()=>{
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
});
