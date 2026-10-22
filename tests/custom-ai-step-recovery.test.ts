import { describe,it,expect,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { toHex } from "viem";
import { recoverStepHash } from "../lib/custom-ai/step-recovery.server";
import type { CustomAIChain } from "../lib/custom-ai/chain.server";
import type { LaunchStep } from "../lib/custom-ai/launch-session";
const account="0x1000000000000000000000000000000000000001";
const hash=`0x${"ab".repeat(32)}`,blockHash=`0x${"cd".repeat(32)}`;
const step:LaunchStep={id:"step",kind:"launch",state:"dispatching",preparedBlock:"100",expiresAt:10,
  transaction:{from:account,to:account,data:"0x",value:"0x0",gas:"0x10000",chainId:1,nonce:"0x4"}};
function chain(mined:number|null,replaceSender=false) {
  const finish=vi.fn(async()=>undefined),methods:string[]=[];
  return {finish,methods,block:{number:"500"},agreed:async(method:string,args:unknown[],parse:(v:unknown)=>unknown)=> {
    methods.push(method);
    if(method==="eth_getTransactionCount")return parse(toHex(mined!==null && Number(BigInt(args[1] as string))>=mined?5:4));
    if(method==="eth_getBlockByNumber")return parse({number:args[0],hash:blockHash,transactions:[{from:replaceSender?"0x2000000000000000000000000000000000000002":account,nonce:"0x4",hash,blockHash}]});
    throw Error("Unexpected method");
  }} as unknown as CustomAIChain & {methods:string[]};
}
describe("lost wallet hash recovery",()=> {
  it("finds the exact nonce with bounded historical reads, without sending",async()=> {
    const reader=chain(347);
    expect(await recoverStepHash(reader,step)).toBe(hash);
    expect(reader.methods.filter(method=>method==="eth_getTransactionCount").length).toBeLessThan(12);
    expect(reader.methods.every(method=>method.startsWith("eth_get"))).toBe(true);
  });
  it("leaves an unknown or pending dispatch unresolved",async()=>expect(await recoverStepHash(chain(null),step)).toBeUndefined());
  it("rejects a nonce consumed before the journal and inconsistent block contents",async()=> {
    await expect(recoverStepHash(chain(90),step)).rejects.toThrow("predates");
    await expect(recoverStepHash(chain(347,true),step)).rejects.toThrow("Inconsistent");
  });
});
