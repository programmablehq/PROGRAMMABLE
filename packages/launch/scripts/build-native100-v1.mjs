import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const root=fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/,'');
const write=process.argv.includes('--write');
const solc=process.env.SOLC ?? homedir()+'/.solc-select/artifacts/solc-0.8.26/solc-0.8.26';
if (!execFileSync(solc,['--version'],{encoding:'utf8'}).includes('0.8.26+commit.8a97fa7a')) throw Error('Wrong compiler');
function output(file,data) {
  if(write) writeFileSync(file,data);
  else if(readFileSync(file,'utf8')!==data) throw Error('Artifact differs: '+file);
}
for (const chain of ['ethereum','robinhood']) {
  const title=chain[0].toUpperCase()+chain.slice(1), folder=chain+'-native100-v1';
  const dir=root+'/packages/launch/contracts/'+folder, hook=title+'Native100HookV1', vault=title+'NativeFeeVaultV1';
  const input=readFileSync(dir+'/'+hook+'.standard-json.json','utf8'), parsed=JSON.parse(input);
  for (const name of [hook,vault]) {
    const source=readFileSync(root+'/contracts/src/'+folder+'/'+name+'.sol','utf8');
    if(source!==parsed.sources['src/'+folder+'/'+name+'.sol'].content || source!==readFileSync(dir+'/'+name+'.sol','utf8')) throw Error('Source package differs');
  }
  const compiled=JSON.parse(execFileSync(solc,['--standard-json'],{input,encoding:'utf8',maxBuffer:25_000_000}));
  const errors=(compiled.errors??[]).filter(e=>e.severity==='error');
  if(errors.length) throw Error(JSON.stringify(errors));
  const names=new Map();
  function visit(n) { if(!n||typeof n!=='object')return; if(n.nodeType==='VariableDeclaration'&&n.mutability==='immutable')names.set(String(n.id),n.name); for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else visit(v);} }
  Object.values(compiled.sources).forEach(s=>visit(s.ast));
  const recipient='0xD88539d3c4C460136a733A3Fd60cf6BF269079da';
  const recipe={sourceArtifactHash:'sha256:'+createHash('sha256').update(input).digest('hex'),sourcePropertyRef:hook+' / '+vault+'; canonical Standard JSON in packages/launch/contracts/'+folder,recipient};
  for(const [role,name] of [['hook',hook],['vault',vault]]) {
    const c=compiled.contracts['src/'+folder+'/'+name+'.sol'][name];
    const immutableWords=Object.entries(c.evm.deployedBytecode.immutableReferences).map(([id,refs])=>({name:names.get(id),byteOffsets:refs.map(r=>r.start)})).sort((a,b)=>a.name.localeCompare(b.name));
    if(immutableWords.some(w=>!w.name)) throw Error('Unknown immutable');
    recipe[role]={runtimeTemplateHex:'0x'+c.evm.deployedBytecode.object,immutableWords};
    output(dir+'/'+name+'.artifact.json',JSON.stringify({contractName:name,compiler:'0.8.26+commit.8a97fa7a',sourceArtifactHash:recipe.sourceArtifactHash,recipient,rateBps:100,abi:c.abi,creationBytecode:'0x'+c.evm.bytecode.object,...recipe[role]},null,2)+'\n');
  }
  output(root+'/lib/custom-launch/'+chain+'-native100-recipes-v1.ts','/** Generated from the published Native100 V1 Standard JSON with solc 0.8.26. */\nexport const '+chain.toUpperCase()+'_NATIVE100_RECIPES_V1 = '+JSON.stringify({native100_fee_kernel_v1:recipe},null,2)+' as const;\n');
  console.log(JSON.stringify({chain,rateBps:100,sourceArtifactHash:recipe.sourceArtifactHash,hookBytes:(recipe.hook.runtimeTemplateHex.length-2)/2,vaultBytes:(recipe.vault.runtimeTemplateHex.length-2)/2}));
}
