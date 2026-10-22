import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../lib/module-foundation/chains", async importOriginal => {
  const original = await importOriginal<typeof import("../lib/module-foundation/chains")>();
  const { keccak256 } = await import("viem");
  return { ...original, foundationChainProfile: (id: 1 | 4663) => ({ ...original.foundationChainProfile(id),
    wrappedEth: { ...original.foundationChainProfile(id).wrappedEth, runtimeCodeHash: keccak256(id === 1 ? "0x6000" : "0x6001") } }) };
});
vi.mock("../lib/custom-ai/quote-runtime-reviews.json", async () => {
  const { keccak256 } = await import("viem");
  return { default: { weth9: { runtimeHash: keccak256("0x6000") },
    transparentProxy: { runtimeHash: keccak256("0x6001") }, aeWETH: { runtimeHash: keccak256("0x6002") } } };
});
import { toHex, type Address } from "viem";
import { inspectCustomAIQuote } from "../lib/custom-ai/quote.server";
import type { CustomAIChain } from "../lib/custom-ai/chain.server";

const quote = "0x1000000000000000000000000000000000000001" as Address;
const implementation = "0x2000000000000000000000000000000000000002" as Address;
const administrator = "0x3000000000000000000000000000000000000003" as Address;
const gateway = "0x4000000000000000000000000000000000000004" as Address;
const amount = 1_000_000_000_000_000n;
const word = (n: bigint) => toHex(n, { size: 32 });
function reader(id: 1 | 4663, options: { unknown?: boolean; changedImplementation?: boolean; fee?: boolean; providerError?: boolean } = {}) {
  const outputs = ["0x", word(amount), word(1n), word(amount), word(1n), word(amount / 2n),
    word(amount / 2n), word(1n), word(amount), word(0n), "0x", word(0n), word(amount / 2n)];
  if (options.fee) outputs[6] = word(amount / 2n - 1n);
  const chain = {
    chainId: id, block: { number: "123", hash: `0x${"ab".repeat(32)}` }, reference: {},
    code: vi.fn(async (address: string) => address === quote
      ? options.unknown ? "0x60ff" : id === 1 ? "0x6000" : "0x6001"
      : address.toLowerCase() === implementation.toLowerCase() ? options.changedImplementation ? "0x60ee" : "0x6002" : "0x"),
    call: vi.fn(async (_address: string, signature: string) => signature.includes("decimals") ? 18 : signature.includes("l2Gateway") ? gateway : 0n),
    agreed: vi.fn(async (method: string, args: unknown[], parse: (x: unknown) => unknown) => {
      if (method === "eth_getStorageAt") return word(BigInt(String(args[1]).startsWith("0x3608") ? implementation : administrator));
      if (options.providerError) throw Error("https://private-rpc.invalid/secret");
      return parse([{ calls: outputs.map(returnData => ({ status: "0x1", returnData })) }]);
    }),
    finish: vi.fn(async () => undefined),
  };
  return chain;
}

describe("Custom AI pair compatibility", () => {
  it("checks the exact selected chain and accepts reviewed normal transfers at any address", async () => {
    const chain = reader(1);
    const result = await inspectCustomAIQuote(1, quote, chain as unknown as CustomAIChain);
    expect(result.status).toBe("compatible");
    expect(result.transferCheck).toBe("passed");
    expect(result.controls).toBeUndefined();
    expect(chain.finish).toHaveBeenCalledOnce();
    await expect(inspectCustomAIQuote(4663, quote, chain as unknown as CustomAIChain)).rejects.toThrow("another network");
  });
  it("keeps upgrade and bridge rights visible when current proxy transfers are compatible", async () => {
    const result = await inspectCustomAIQuote(4663, quote, reader(4663) as unknown as CustomAIChain);
    expect(result.status).toBe("compatible");
    expect(result.controlCheck).toBe("verified-proxy-runtime");
    expect(result.controls).toMatchObject({ implementation, administrator, gateway, upgradeable: true, bridgeCanBurn: true });
    expect(result.message).toContain("upgradeable");
    expect(result.message).toContain("burn balances");
  });
  it("does not reuse old implementation approval after a proxy changes", async () => {
    const result = await inspectCustomAIQuote(4663, quote, reader(4663, { changedImplementation: true }) as unknown as CustomAIChain);
    expect(result.status).toBe("unresolved");
    expect(result.controls).toBeUndefined();
    expect(result.transferCheck).toBe("unresolved");
  });
  it.each([{ fee: true }, { providerError: true }, { unknown: true }])("blocks unproven or inexact transfers: %j", async options => {
    const result = await inspectCustomAIQuote(1, quote, reader(1, options) as unknown as CustomAIChain);
    expect(result.status).toBe("unresolved");
    expect(result.transferCheck).toBe("unresolved");
    expect(JSON.stringify(result)).not.toContain("private-rpc");
  });
  it("rejects a check if its block ceases to be canonical", async () => {
    const chain = reader(1);
    chain.finish.mockRejectedValue(Error("Block changed"));
    await expect(inspectCustomAIQuote(1, quote, chain as unknown as CustomAIChain)).rejects.toThrow("Block changed");
  });
});
