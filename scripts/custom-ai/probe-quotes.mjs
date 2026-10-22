import { readFile, writeFile, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';
const [rpcFile, outputFile] = process.argv.slice(2);
if (!rpcFile || !outputFile) throw Error('Expected private RPC file and evidence output file');
const stat = await lstat(rpcFile);
if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) throw Error('RPC file must be private');
for (const [key,value] of Object.entries(JSON.parse(await readFile(rpcFile,'utf8')))) {
  if (!/^(PROGRAMMABLE_WEBSITE_MAINNET_RPC_(PRIMARY|SECONDARY)_(PROVIDER|URL|ENDPOINT_COMMITMENT)|ROBINHOOD_V4_RPC_(PRIMARY|SECONDARY)_URL)$/.test(key) || typeof value !== 'string') throw Error('Unexpected RPC binding');
  process.env[key] = value;
}
const root=resolve(import.meta.dirname,'../..');
const built=await build({absWorkingDir:root,stdin:{contents:"export { inspectCustomAIQuote } from './lib/custom-ai/quote.server'; export { foundationChainProfile } from './lib/module-foundation/chains';",resolveDir:root},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,
  plugins:[{name:'operator',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));}}]});
const loaded={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
const evidence=[];
for (const [chainId,address] of [[1,loaded.exports.foundationChainProfile(1).wrappedEth.address],[4663,loaded.exports.foundationChainProfile(4663).wrappedEth.address],[1,'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48']]) {
  try {const result=await loaded.exports.inspectCustomAIQuote(chainId,address);evidence.push(result);console.log(JSON.stringify(result));}
  catch(error) {const result={chainId,address,status:'unresolved',error:error instanceof Error?error.message.replace(/https?:\/\/\S+/g,'[provider]'):'Probe failed'};evidence.push(result);console.log(JSON.stringify(result));}
}
await writeFile(outputFile,JSON.stringify({checkedAt:new Date().toISOString(),mode:'simulation-only',evidence},null,2)+'\n',{flag:'wx'});
