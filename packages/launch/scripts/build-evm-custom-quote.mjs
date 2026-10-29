import fs from 'node:fs';
import {createHash} from 'node:crypto';
import solc from 'solc';
const root=new URL('../../../',import.meta.url);
if(solc.version()!=='0.8.26+commit.8a97fa7a.Emscripten.clang')throw Error('Exact Solidity 0.8.26 required');
const source=fs.readFileSync(new URL('contracts/src/evm-custom-v1/EvmCustomSwapQuoteV1.sol',root),'utf8');
const input={language:'Solidity',sources:{'EvmCustomSwapQuoteV1.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',metadata:{bytecodeHash:'none',appendCBOR:false},outputSelection:{'*':{'*':['abi','evm.deployedBytecode.object']}}}};
const result=JSON.parse(solc.compile(JSON.stringify(input)));if(result.errors?.some(e=>e.severity==='error'))throw Error(JSON.stringify(result.errors));
const artifact=result.contracts['EvmCustomSwapQuoteV1.sol'].EvmCustomSwapQuoteV1;
const bytes=JSON.stringify({compiler:solc.version(),sourceSha256:createHash('sha256').update(source).digest('hex'),abi:artifact.abi,runtime:'0x'+artifact.evm.deployedBytecode.object},null,2)+'\n';
const target=new URL('lib/swap/evm-quote-artifact.json',root);
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8')!==bytes)throw Error('Quote artifact differs from source');}
else fs.writeFileSync(target,bytes);
