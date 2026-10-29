import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import * as client from '../programmable-launch-v430-release-binding.mjs';
import {releaseBindingTools} from '../programmable-launch-release-assets.mjs';
const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url));
test('4.3.0 binds launch protection while retaining historical policy identities',()=>{
 const result=client.auditV430ClientSource({repositoryRoot});
 assert.equal(result.productionEvidenceVerified,false);
 assert.equal(result.binding.ethereumClient.profile36Fee100RateBps,100);
 assert.equal(result.binding.ethereumClient.profile36Fee100PolicyHash,'sha256:d4a42d5f04f9f94f3b45544facdda5576bcb538381134b93d14d992b62ad971a');
 assert.equal(result.binding.ethereumClient.profile36TradeFeePolicyHash,'sha256:5956cdeee628ba84dfa5214efd532011e59c202e4e1c1830b1eca279d58d79d3');
 assert.equal(releaseBindingTools('4.3.0'),client);
 assert.ok(result.binding.clientFiles.some(f=>f.path.endsWith('launch-protection-v1.mjs')));
 assert.ok(result.binding.clientFiles.some(f=>f.path.endsWith('ProtectedLaunchTokenV1.artifact.json')));
 assert.equal(result.binding.baseClient.chainId,'8453');
 assert.equal(result.binding.baseClient.moduleMode,false);
 const schema=JSON.parse(readFileSync(repositoryRoot+'/docs/operations/releases/custom-launch-v4.3.0/cli-release-binding.schema.json'));
 const validate=new Ajv2020({strict:false}).compile(schema);assert.ok(validate(result.binding),JSON.stringify(validate.errors));
});
test('4.3.0 rejects substituted rates and policy hashes',()=>{
 const binding=client.createV430ClientReleaseBinding({repositoryRoot});
 for(const mutate of [b=>b.ethereumClient.profile36Fee100RateBps=50,b=>b.ethereumClient.profile36Fee100PolicyHash=b.ethereumClient.profile36TradeFeePolicyHash]){
  const changed=structuredClone(binding);mutate(changed);
  assert.throws(()=>client.auditV430ClientSource({repositoryRoot,bindingBytes:Buffer.from(JSON.stringify(changed))}),/exact client source binding/);
 }
});
