import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import * as client from '../programmable-launch-v430-release-binding.mjs';
import {releaseBindingTools} from '../programmable-launch-release-assets.mjs';
import {V4_RELEASE_BINDING_PATH as API_BINDING_PATH} from '../programmable-launch-v41-release-binding.mjs';
const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
const acceptance='docs/operations/releases/custom-launch-v4.3.0/hyperevm-live-acceptance.json';
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'launch-v430-source-test-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const extra=[API_BINDING_PATH,'public/openapi/launch-coverage-v1.json','public/schemas/custom-launch/coverage/v1.json',
  'docs/operations/releases/custom-launch-v4.3.0/cli-release-binding.schema.json'];
 for(const relative of new Set([...client.V430_CLIENT_SOURCE_FILES,...extra])) {
  const file=join(root,relative);mkdirSync(dirname(file),{recursive:true});
  // Candidate source-binding tests exercise hashes only. This explicit fixture
  // is never written into the repository or accepted as live release evidence.
  writeFileSync(file,relative===acceptance?JSON.stringify({fixtureOnly:true}):readFileSync(join(sourceRoot,relative)));
 }
 const binding=client.createV430ClientReleaseBinding({repositoryRoot:root});
 writeFileSync(join(root,client.V4_RELEASE_BINDING_PATH),JSON.stringify(binding));
 return root;
}
test('4.3.0 binds launch protection while retaining historical policy identities',t=>{
 const repositoryRoot=fixture(t);
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
test('4.3.0 rejects substituted rates and policy hashes',t=>{
 const repositoryRoot=fixture(t);
 const binding=client.createV430ClientReleaseBinding({repositoryRoot});
 for(const mutate of [b=>b.ethereumClient.profile36Fee100RateBps=50,b=>b.ethereumClient.profile36Fee100PolicyHash=b.ethereumClient.profile36TradeFeePolicyHash]){
  const changed=structuredClone(binding);mutate(changed);
  assert.throws(()=>client.auditV430ClientSource({repositoryRoot,bindingBytes:Buffer.from(JSON.stringify(changed))}),/exact client source binding/);
 }
});
test('4.3.0 requires the HyperEVM acceptance bytes in its source binding',t=>{
 const repositoryRoot=fixture(t);
 rmSync(join(repositoryRoot,acceptance));
 assert.throws(()=>client.createV430ClientReleaseBinding({repositoryRoot}),/ENOENT/);
});
