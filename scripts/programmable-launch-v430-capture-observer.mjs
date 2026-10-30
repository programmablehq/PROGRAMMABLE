import assert from 'node:assert/strict';
import {ROBINHOOD_PROFILE_V41} from '../packages/launch/src/profile-v41.mjs';
import * as releaseTools from './programmable-launch-v41-release-binding.mjs';
import * as originalPostdeployTools from '../contracts/scripts/robinhood-custom-launch-postdeploy-core.mjs';
import {createRobinhoodPostdeploymentCli} from '../contracts/scripts/finalize-robinhood-custom-launch-deployment.mjs';
import {createRobinhoodBackendPromotionTools} from '../contracts/scripts/robinhood-backend-promotion-v1.mjs';
import {ROBINHOOD_V41_BACKEND_RELEASE_PINS} from '../contracts/scripts/robinhood-backend-promotion-v41.mjs';
import {robinhoodV41BackendStageContext,prepareRobinhoodV41ReleaseBinding,robinhoodV41ConsumerInputs}
  from '../contracts/scripts/robinhood-custom-launch-v41-release-context.mjs';
import {runRobinhoodV41PostdeploymentCli} from '../contracts/scripts/finalize-robinhood-custom-launch-v41-deployment.mjs';

export const RUNTIME_CAPTURE_AUTHORITY_PATH='release/robinhood-chain-4663/v4.3.0/runtime-capture-authority.json';
const WORKFLOW='.github/workflows/capture-programmable-robinhood-v43-promotion.yml';
const REPOSITORY='programmablehq/programmable-open-hook-v2-internal';

export function createReadOnlyFlyFetch(request,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
  return async(url,options)=>{
    const {hostname,pathname}=new URL(url);
    const method=options?.method??'GET';
    const readOnly=method==='GET'||method==='POST'&&hostname==='api.fly.io'&&pathname==='/graphql'
      &&typeof options.body==='string'&&/^\s*query\s+ProgrammableRobinhoodRelease\b/.test(JSON.parse(options.body).query??'');
    if(!readOnly||!['api.fly.io','api.machines.dev'].includes(hostname))return request(url,options);
    for(let attempt=0;attempt<3;attempt++){
      try{
        const attemptOptions=attempt>0&&options?.signal?.aborted&&options.signal.reason?.name==='TimeoutError'
          ?{...options,signal:AbortSignal.timeout(15000)}:options;
        const response=await request(url,attemptOptions);
        if(![429,502,503,504].includes(response.status)||attempt===2)return response;
        await response.body?.cancel();
      }catch(error){
        if(attempt===2||error?.name!=='TimeoutError'
          &&!['ETIMEDOUT','ECONNRESET'].includes(error?.cause?.code))throw error;
      }
      await wait(1000*(attempt+1));
    }
  };
}

export function createV430CaptureVerifier(authority){
  assert.deepEqual(Object.keys(authority).sort(),['schemaVersion','runtime','observer'].sort());
  assert.equal(authority.schemaVersion,'programmable.runtime-capture-observer.v1');
  for(const source of [authority.runtime,authority.observer]){
    assert.deepEqual(Object.keys(source).sort(),['repository','sourceCommit','sourceTree'].sort());
    assert.equal(source.repository,REPOSITORY);
    for(const field of ['sourceCommit','sourceTree'])assert.match(source[field],/^(?!0{40}$)[0-9a-f]{40}$/u);
  }
  const pins=ROBINHOOD_V41_BACKEND_RELEASE_PINS;
  const backendTools=createRobinhoodBackendPromotionTools({
    profile:ROBINHOOD_PROFILE_V41,captureObserverSource:structuredClone(authority),flyReleasePageSize:32,
    ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW:releaseTools.V4_BACKEND_AUTHORIZATION_WORKFLOW,
    ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH:'release/robinhood-chain-4663/v4.3.0/backend-promotion-input.json',
    ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH:'release/robinhood-chain-4663/v4.3.0/backend-promotion-input.public.json',
    ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH:'release/robinhood-chain-4663/v4.3.0/backend-promotion-input.attestation.json',
    ROBINHOOD_BACKEND_AUTHORIZATION_PATH:releaseTools.V4_ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
    ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH:releaseTools.V4_ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
    ROBINHOOD_BACKEND_CAPTURE_WORKFLOW:WORKFLOW,
    ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME:'Capture Programmable Robinhood v4.3 backend promotion',
    ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY:`https://github.com/${REPOSITORY}/${WORKFLOW}@refs/heads/main`,
    BACKEND_MIGRATION_PATH:'migrations/0029_activate_robinhood_fee_profile_v41.sql',
    BACKEND_MIGRATION_SHA256:pins.migrationSha256,
    BACKEND_API_CONTRACT_PATH:'release/custom-launch-api-contract.v4.1.json',
    BACKEND_API_CONTRACT_SHA256:pins.apiContractSha256,ROBINHOOD_PROVIDER_PROFILE_SHA256:pins.providerProfileDigest,
  });
  const promotionTools=originalPostdeployTools.createRobinhoodPromotionTools({releaseTools,backendTools,
    backendStageContext:robinhoodV41BackendStageContext,prepareReleaseBinding:prepareRobinhoodV41ReleaseBinding,
    consumerInputs:robinhoodV41ConsumerInputs});
  const importer=createRobinhoodPostdeploymentCli({releaseTools,backendTools,
    postdeployTools:{...originalPostdeployTools,...promotionTools,ROBINHOOD_PROMOTION_BUNDLE_PATH:releaseTools.V4_ROBINHOOD_PROMOTION_BUNDLE_PATH},
    backendStageContext:robinhoodV41BackendStageContext,allowedCommands:['verify-backend-import']});
  return {
    backendTools,
    runFinalizer:(argv,dependencies)=>argv[0]==='verify-backend-import'
      ?importer.runRobinhoodPostdeploymentCli(argv,dependencies)
      :runRobinhoodV41PostdeploymentCli(argv,dependencies),
    freshVerifyBackend:options=>backendTools.freshVerifyRobinhoodBackendPromotionInput({...options,
      fetch:createReadOnlyFlyFetch(options.fetch??globalThis.fetch)}),
  };
}
