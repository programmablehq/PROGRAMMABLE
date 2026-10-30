import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createV430CaptureVerifier,createReadOnlyFlyFetch} from '../programmable-launch-v430-capture-observer.mjs';
import {robinhoodV41BackendPromotionTools} from '../../contracts/scripts/robinhood-backend-promotion-v41.mjs';

const authority={schemaVersion:'programmable.runtime-capture-observer.v1',
  runtime:{repository:'programmablehq/programmable-open-hook-v2-internal',sourceCommit:'1'.repeat(40),sourceTree:'2'.repeat(40)},
  observer:{repository:'programmablehq/programmable-open-hook-v2-internal',sourceCommit:'3'.repeat(40),sourceTree:'4'.repeat(40)}};

test('separate observer verification retains the exact deployed source and pins the capture signer',()=>{
  const {backendTools}=createV430CaptureVerifier(authority);
  const args=backendTools.buildRobinhoodBackendCosignVerifyBlobArgs({subjectPath:'/subject',bundlePath:'/bundle',sourceCommit:authority.runtime.sourceCommit});
  assert.equal(args[args.indexOf('--certificate-github-workflow-sha')+1],authority.observer.sourceCommit);
  assert.ok(args.includes('https://github.com/programmablehq/programmable-open-hook-v2-internal/.github/workflows/capture-programmable-robinhood-v43-promotion.yml@refs/heads/main'));
  assert.throws(()=>backendTools.buildRobinhoodBackendCosignVerifyBlobArgs({subjectPath:'/subject',bundlePath:'/bundle',sourceCommit:'5'.repeat(40)}),/reviewed observer binding/);
});

test('historical v4.1 capture verification still requires its deployed commit as signer',()=>{
  const args=robinhoodV41BackendPromotionTools.buildRobinhoodBackendCosignVerifyBlobArgs({subjectPath:'/subject',bundlePath:'/bundle',sourceCommit:authority.runtime.sourceCommit});
  assert.equal(args[args.indexOf('--certificate-github-workflow-sha')+1],authority.runtime.sourceCommit);
  assert.ok(args.includes('Capture Programmable Robinhood v4.1 backend promotion'));
});

test('observer binding rejects missing pins, a different repository and additional authority',()=>{
  for(const mutate of [a=>delete a.runtime.sourceTree,a=>a.observer.repository='another/repository',a=>a.runtime.sourceCommit='0'.repeat(40),a=>a.skipImageVerification=true]){
    const bad=structuredClone(authority);mutate(bad);assert.throws(()=>createV430CaptureVerifier(bad));
  }
});

test('only transient read responses retry and stop after three attempts',async()=>{
  let reads=0;
  const fetch=createReadOnlyFlyFetch(async()=>({status:++reads===1?503:200}),async()=>{});
  assert.equal((await fetch('https://api.machines.dev/v1/apps/app',{})).status,200);
  assert.equal(reads,2);
  reads=0;
  const unavailable=createReadOnlyFlyFetch(async()=>{reads++;return {status:503};},async()=>{});
  assert.equal((await unavailable('https://api.machines.dev/v1/apps/app',{})).status,503);
  assert.equal(reads,3);
});

test('authentication errors and mutations are never retried',async()=>{
  for(const [options,status] of [[{},401],[{method:'POST'},503]]){
    let reads=0;
    const fetch=createReadOnlyFlyFetch(async()=>{reads++;return {status};},async()=>{});
    assert.equal((await fetch('https://api.machines.dev/v1/apps/app',options)).status,status);
    assert.equal(reads,1);
  }
});
