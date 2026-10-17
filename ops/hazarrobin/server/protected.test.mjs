import {expect,it} from 'vitest';
import {getContractAddress,keccak256,toHex} from 'viem';
import {LAUNCH_PROTECTION_RECIPES_V1} from '../vendor/native-proofs.mjs';
import {protectedCandidate,proveProtectedVaults} from './protected.mjs';
const a=n=>toHex(n,{size:20}), word=v=>toHex(BigInt(v),{size:32});
function runtime(recipe,words){let code=recipe.runtimeTemplateHex;for(const item of recipe.immutableWords)for(const offset of item.byteOffsets){const start=2+offset*2;code=code.slice(0,start)+word(words[item.name]??1).slice(2)+code.slice(start+64);}return code;}
function fixture(chainId){
 const recipe=Object.values(LAUNCH_PROTECTION_RECIPES_V1).at(-1), hook=a(0x120cc),token=a(4),manager=chainId===1?'0x000000000004444c5dc75cB358380D2e3dE08A90':'0x8366a39CC670B4001A1121B8F6A443A643e40951',developer=a(5);
 const vault=getContractAddress({from:hook,nonce:1n}),module=getContractAddress({from:hook,nonce:2n}),opening=getContractAddress({from:hook,nonce:3n});
 const moduleCode=runtime(recipe.module,{kernel:hook,token,developer});
 const code=runtime(recipe.hook,{CHAIN_ID:chainId,poolManager:manager,CANONICAL_POOL_MANAGER:manager,token,lpFee:0,tickSpacing:60,feeVault:vault,module,openingTaxVault:opening,moduleCodeHash:keccak256(moduleCode)});
 return {market:{chainId:String(chainId),hooks:hook,currency0:a(0),currency1:token,poolManager:manager,fee:0,tickSpacing:60},code,codes:{[module]:moduleCode,[vault]:runtime(recipe.vault,{kernel:hook,poolManager:manager,creatorRecipient:developer}),[opening]:runtime(recipe.vault,{kernel:hook,poolManager:manager,creatorRecipient:recipe.recipient})}};
}
it.each([1,4663])('binds normal and opening-tax custody on chain %s',chainId=>{const f=fixture(chainId),c=protectedCandidate(f.market,f.code);const vaults=proveProtectedVaults(c,f.codes);expect(vaults).toHaveLength(2);expect(vaults[1].opening).toBe(true);expect(vaults[1].creator).toBe(vaults[1].recipient.toLowerCase());});
it('rejects a different chain or a tampered opening-tax vault',()=>{const f=fixture(4663);expect(()=>protectedCandidate({...f.market,chainId:'1'},f.code)).toThrow();const c=protectedCandidate(f.market,f.code);const key=Object.keys(f.codes).find(k=>k.toLowerCase()===c.opening.toLowerCase());f.codes[key]='0x00'+f.codes[key].slice(4);expect(()=>proveProtectedVaults(c,f.codes)).toThrow();});
