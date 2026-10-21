import {expect,it} from 'vitest';
import {publicRpcError} from '../api/rpc.mjs';
it('keeps nested gas capacity errors actionable without exposing provider details',()=>{
 const error={message:'POST https://rpc.example/secret-key failed',cause:{code:-32000,shortMessage:'Multicall3: call failed',data:'0x1234'}};
 expect(publicRpcError(error,'eth_estimateGas')).toEqual({code:-32000,message:'Simulation gas cap exceeded.',data:'0x1234'});
 expect(publicRpcError(error,'eth_call').message).toBe('Netzwerkanfrage fehlgeschlagen.');
});
it('does not mislabel a quota error or return arbitrary error data',()=>{
 expect(publicRpcError({code:-32005,message:'rate limit exceeded',data:'https://rpc.example/secret'},'eth_estimateGas'))
  .toEqual({code:-32005,message:'Netzwerkanfrage fehlgeschlagen.'});
});
