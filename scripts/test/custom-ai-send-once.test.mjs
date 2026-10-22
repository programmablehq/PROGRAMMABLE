import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { maximumCost, sendOnce } from "../custom-ai/send-once.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(),"custom-ai-sender-"));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const account=privateKeyToAccount(generatePrivateKey());
  const state={ sends:0, failSend:false, receipt:null };
  const rpc=async (method, params) => {
    if(method==="eth_chainId") return "0x1";
    if(method==="eth_getTransactionCount") return "0x0";
    if(method==="eth_gasPrice") return "0x3b9aca00";
    if(method==="eth_estimateGas") return "0x5208";
    if(method==="eth_getBalance") return "0xde0b6b3a7640000";
    if(method==="eth_getTransactionReceipt") return state.receipt;
    if(method==="eth_getTransactionByHash") return null;
    if(method==="eth_getBlockByNumber") return {hash:`0x${"12".repeat(32)}`};
    if(method==="eth_sendRawTransaction") {
      state.sends++;
      if(state.failSend) throw Error("Lost response");
      return keccak256(params[0]);
    }
    throw Error(`Unexpected test RPC ${method}`);
  };
  return {state,options:{directory,id:"eth-core",account,chainId:1,
    transaction:{to:account.address,data:"0x",value:"0x1",gas:"0x5208",nonce:"0x0"},
    rpcs:[rpc,rpc],totalCap:30_000_000_000_000_000n,chainCap:15_000_000_000_000_000n}};
}

test("persisted dispatch is never broadcast again, including a lost response",async t=>{
  const {state,options}=await fixture(t);state.failSend=true;
  const first=await sendOnce(options);
  assert.equal(first.state,"uncertain");assert.equal(state.sends,1);
  const saved=JSON.parse(await readFile(join(options.directory,"eth-core.json"),"utf8"));
  assert.equal(keccak256(saved.raw),first.hash);
  assert.equal((await sendOnce(options)).hash,first.hash);assert.equal(state.sends,1);
  await assert.rejects(sendOnce({...options,id:"eth-duplicate"}),/nonce is already journaled/);
  await assert.rejects(sendOnce({...options,transaction:{...options.transaction,value:"0x2"}}),/Saved request differs/);
});

test("cap rejects signing and dispatch; confirmed receipt reconciles exact gas",async t=>{
  const {state,options}=await fixture(t);
  await assert.rejects(sendOnce({...options,chainCap:1n}),/spending cap/);assert.equal(state.sends,0);
  const result=await sendOnce(options);
  state.receipt={transactionHash:result.hash,blockHash:`0x${"12".repeat(32)}`,blockNumber:"0x10",
    status:"0x1",gasUsed:"0x5208",effectiveGasPrice:"0x3b9aca00",contractAddress:null};
  const confirmed=await sendOnce(options);
  assert.equal(confirmed.state,"confirmed");assert.equal(state.sends,1);
  assert.equal(confirmed.costWei,"21000000000001");
  assert.equal(maximumCost({transaction:{value:100,gas:21000,gasPrice:1},receipt:{status:0,gasUsed:10000,effectiveGasPrice:1}}),10000n);
});
