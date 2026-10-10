import { describe, it, expect, vi } from 'vitest';
import { mapLimit, paced, recoverRpcRead } from './rpc.mjs';

describe('scan recovery', () => {
  it('budgets every RPC call inside a batch below the provider 50/s limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const starts=[];
      const send=paced(async()=>{starts.push(Date.now());return {};});
      const body=JSON.stringify(Array.from({length:10},(_,id)=>({jsonrpc:'2.0',id,method:'eth_getCode',params:[]})));
      const pending=Promise.all(Array.from({length:12},()=>send('https://rpc.example',{body})));
      await vi.runAllTimersAsync();
      await pending;
      expect(starts).toHaveLength(12);
      for(const start of starts) expect(starts.filter(time=>time>=start&&time<start+1000).length*10).toBeLessThanOrEqual(40);
    } finally { vi.useRealTimers(); }
  });
  it('retries the provider JSON-RPC rate limit without relaxing proof checks', async () => {
    vi.useFakeTimers();
    try {
      const read=vi.fn().mockRejectedValueOnce(Object.assign(new Error('RPC request failed'),{
        name:'RpcRequestError',cause:{code:-32007},
      })).mockResolvedValueOnce(42);
      const retry=vi.fn(),result=recoverRpcRead(read,retry);
      await vi.runAllTimersAsync();
      expect(await result).toBe(42);
      expect(read).toHaveBeenCalledTimes(2);
      expect(retry).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('stops scheduling work and drains active reads before reporting a failed source', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const started = [];
    let finished = false;
    const failure = new Error('source interrupted');
    const result = mapLimit([0, 1, 2, 3], 2, async i => {
      started.push(i);
      if (i === 0) throw failure;
      await pending;
    }).catch(error => { finished = true; return error; });
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(finished).toBe(false);
    release();
    expect(await result).toBe(failure);
    expect(started).toEqual([0, 1]);
  });
  it('preserves input order on successful concurrent reads', async () => {
    expect(await mapLimit([3, 1, 2], 2, async n => n * 2)).toEqual([6, 2, 4]);
  });
  it('recovers one interrupted read but never repeats a failed contract proof', async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn().mockRejectedValueOnce(Object.assign(new Error('private RPC details'), { name: 'TimeoutError' })).mockResolvedValueOnce(42);
      const retry = vi.fn();
      const result = recoverRpcRead(read, retry);
      await vi.runAllTimersAsync();
      expect(await result).toBe(42);
      expect(read).toHaveBeenCalledTimes(2);
      expect(retry).toHaveBeenCalledOnce();
      const proof = vi.fn().mockRejectedValue(new Error('Contract does not match'));
      await expect(recoverRpcRead(proof)).rejects.toThrow('Contract does not match');
      expect(proof).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('does not retry an execution revert wrapped in an RPC error', async () => {
    const read = vi.fn().mockRejectedValue(Object.assign(new Error('RPC'), {
      name: 'HttpRequestError', cause: Object.assign(new Error('reverted'), { name: 'ExecutionRevertedError' }),
    }));
    await expect(recoverRpcRead(read)).rejects.toThrow('RPC');
    expect(read).toHaveBeenCalledOnce();
  });
});
