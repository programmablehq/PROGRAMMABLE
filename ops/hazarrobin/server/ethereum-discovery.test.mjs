import { beforeEach, expect, it, vi } from 'vitest';
import { keccak256 } from 'viem';

const mocks=vi.hoisted(()=>({logs:[],values:[],pin:vi.fn(),reads:vi.fn()}));
vi.mock('../vendor/deployments.json',async()=>{
  const {keccak256}=await import('viem');
  const release=(code,start,address)=>({payload:{startBlock:start,proxyRuntimeCodeHash:keccak256(code),
    implementation:{address,runtimeCodeHash:keccak256('0x1234')}}});
  return {default:{ethereumModuleHistory:[release('0x6001',200,'0x0000000000000000000000000000000000000022'),
    release('0x6000',100,'0x0000000000000000000000000000000000000011')],
    ethereum:{canonicalStamp:{graphFactory:{address:'0x0000000000000000000000000000000000000033'}}}}};
});
vi.mock('./rpc.mjs',async original=>({...await original(),pin:mocks.pin,
  rangeLogs:async()=>mocks.logs,readBoth:async(_c,calls)=>{mocks.reads(calls);return mocks.values;}}));
import { ethereumDiscovery } from './scanner.mjs';

const a=n=>`0x${n.toString(16).padStart(40,'0')}`;
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.logs=[{address:a(1),blockNumber:150n,args:{token:a(4),ledger:a(5)}},
    {address:a(2),blockNumber:210n,args:{token:a(6),ledger:a(7)}},
    {address:a(3),blockNumber:220n,args:{token:a(8),ledger:a(9)}}];
  mocks.values=[a(17),keccak256('0x1234'),a(51),true,a(34),keccak256('0x1234'),a(51),true];
});
function clients(disagree=false){return [0,1].map(index=>({getCode:async({address})=>
  address===a(1)?'0x6000':address===a(2)?(disagree&&index===1?'0x6009':'0x6001'):'0x6002'}));}
it('discovers old and new module accounts together and excludes unrelated event emitters',async()=>{
  const found=await ethereumDiscovery(clients(),{number:250n},{v3:[{type:'event'}]});
  expect(found.map(r=>r.token)).toEqual([a(4),a(6)]);
  expect(found.map(r=>r.release.startBlock)).toEqual([100n,200n]);
  expect(mocks.reads.mock.calls[0][0]).toHaveLength(8);
});
it('rejects provider disagreement and a substituted implementation',async()=>{
  await expect(ethereumDiscovery(clients(true),{number:250n},{v3:[{type:'event'}]})).rejects.toThrow('Anbietern');
  mocks.values[4]=a(99);
  await expect(ethereumDiscovery(clients(),{number:250n},{v3:[{type:'event'}]})).rejects.toThrow('Quelle');
});
