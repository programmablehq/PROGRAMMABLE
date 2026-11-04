import {beforeEach, describe, expect, it, vi} from "vitest";
import {parseAbi} from "viem";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({source: vi.fn(), read: vi.fn(), prepare: vi.fn()}));
vi.mock("../lib/custom-ai/auth.server", () => ({requireFreshCustomAIAuthority: (_: unknown, auth: unknown) => auth}));
vi.mock("../lib/custom-ai/product/runtime-source.server", () => ({readProductRuntimeSource: mock.source}));
vi.mock("../lib/custom-ai/product/action-read.server", () => ({readProductAction: mock.read}));
vi.mock("../lib/custom-ai/product/action-prepare.server", () => ({prepareProductActionInput: mock.prepare}));
import {createProductValueReader} from "../lib/custom-ai/product/action-service.server";
import {automaticProductRead} from "../lib/custom-ai/product/action-automatic";
import type {AIStore} from "../lib/custom-ai/store.server";
import type {AIAuthority} from "../lib/custom-ai/auth.server";
import type {ProductRuntime} from "../lib/custom-ai/product/runtime";

const wallet = `0x${"1".repeat(40)}` as const, id = "product-preparation-0001";
const auth = {kind: "account", owner: "private-owner", principal: {wallets: [wallet]}} as unknown as AIAuthority;
const source = {id: "source-one", controller: wallet, chainId: 1,
  implementation: {actions: [{id: "inspect", target: "vault", signature: "claimable(address)", mutability: "view"}],
    components: [{id: "vault", source: "Vault.sol", contract: "Vault"}]},
  contracts: [{source: "Vault.sol", contract: "Vault", abi: parseAbi(["function claimable(address account) view returns (uint256)"])}]};
beforeEach(() => {
  vi.clearAllMocks(); mock.source.mockResolvedValue(source); mock.read.mockResolvedValue({state: "value-observed", outputs: []});
  mock.prepare.mockReturnValue({id: "call-one", caller: wallet, target: wallet, data: "0x12345678"});
});
const request = () => new Request(`https://site.test/api/custom-ai/product-value?id=${id}&action=inspect`);
function fixture() {
  let time = 1000;
  const runtime = vi.fn().mockResolvedValue({block: {hash: "block-one", number: "12"}, checkedAt: "time-one"} as unknown as ProductRuntime);
  const pair = [vi.fn(), vi.fn()] as const, rpcs = vi.fn().mockReturnValue(() => pair);
  const read = createProductValueReader({store: () => ({} as AIStore), runtime, rpcs, now: () => time});
  return {read, runtime, rpcs, advance: (ms: number) => {time += ms;}};
}
describe("requested product values", () => {
  it("keeps a shared value read alive when its first caller leaves",async()=>{
    const f=fixture();let finish!:(value:unknown)=>void,signal!:AbortSignal;
    mock.read.mockImplementation((_source,_runtime,_request,_rpcs,options)=>{signal=options.signal;return new Promise((resolve,reject)=>{
      finish=resolve;signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
    });});
    const controller=new AbortController();
    const first=f.read(new Request(request(),{signal:controller.signal}),auth,id,"inspect").catch(error=>error),second=f.read(request(),auth,id,"inspect");
    await vi.waitFor(()=>expect(mock.read).toHaveBeenCalledOnce());controller.abort();
    expect((await first).name).toBe("AbortError");expect(signal.aborted).toBe(false);
    finish({state:"value-observed",outputs:[]});await expect(second).resolves.toHaveProperty("value.state","value-observed");
    await f.read(request(),auth,id,"inspect");expect(mock.read).toHaveBeenCalledOnce();
  });
  it("binds the caller and function, coalesces concurrent reads and keeps fresh snapshots separate", async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.read(request(), auth, id, "inspect"), f.read(request(), auth, id, "inspect")]);
    expect(a).toEqual(b); expect(a).not.toBe(b); expect(mock.read).toHaveBeenCalledOnce();
    expect(mock.source).toHaveBeenCalledWith(expect.anything(), "private-owner", id);
    expect(mock.prepare).toHaveBeenCalledWith(source, "inspect", wallet, [wallet]);
    expect(f.rpcs).toHaveBeenCalledWith({productActionRead: {chainId: 1, from: wallet, to: wallet, data: "0x12345678", blockNumber: "12", blockHash: "block-one"}});
    await f.read(request(), auth, id, "inspect"); expect(mock.read).toHaveBeenCalledOnce();
    f.runtime.mockResolvedValue({block: {hash: "block-one", number: "12"}, checkedAt: "time-two"});
    await f.read(request(), auth, id, "inspect"); expect(mock.read).toHaveBeenCalledTimes(2);
    f.advance(10_001); await f.read(request(), auth, id, "inspect"); expect(mock.read).toHaveBeenCalledTimes(3);
  });
  it("rechecks the linked wallet on cached reads and blocks writes or unbound actions before RPC", async () => {
    const f = fixture(); await f.read(request(), auth, id, "inspect");
    const other = {...auth, principal: {wallets: [`0x${"2".repeat(40)}`]}} as unknown as AIAuthority;
    await expect(f.read(request(), other, id, "inspect")).rejects.toMatchObject({code: "wallet"});
    await expect(f.read(request(), auth, id, "deposit")).rejects.toMatchObject({code: "product-value-action"});
    mock.source.mockResolvedValue({...source, contracts: [{...source.contracts[0], abi: parseAbi(["function claimable(address account) returns (uint256)"])}]});
    await expect(f.read(request(), auth, id, "inspect")).rejects.toMatchObject({code: "product-value-action"});
    expect(mock.read).toHaveBeenCalledOnce();
  });
  it("backs off from failed providers without presenting a successful value", async () => {
    const f = fixture(); mock.read.mockRejectedValue(Error("provider unavailable"));
    await expect(f.read(request(), auth, id, "inspect")).rejects.toMatchObject({code: "product-value-unconfirmed"});
    await expect(f.read(request(), auth, id, "inspect")).rejects.toMatchObject({code: "product-value-unconfirmed"});
    expect(mock.read).toHaveBeenCalledOnce(); f.advance(3001);
    await expect(f.read(request(), auth, id, "inspect")).rejects.toMatchObject({code: "product-value-unconfirmed"});
    expect(mock.read).toHaveBeenCalledTimes(2);
  });
  it("does not invent asset or strategy inputs from an address parameter", () => {
    const abi = parseAbi(["function totalSupply() view returns (uint256)", "function balanceOf(address account) view returns (uint256)",
      "function price(address token) view returns (uint256)", "function claim(address recipient)"]);
    expect(abi.map(automaticProductRead)).toEqual(["none", "wallet", undefined, undefined]);
  });
});
