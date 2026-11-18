import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: <T>(read: T) => read }));
vi.mock("../lib/onchain/config", () => ({
  getWebsiteReadOnchainDeployment: () => ({ status:"ready", rpcUrl:"https://primary.example/rpc" }),
}));

import { readClassicCatalogGroups, readClassicLaunchCatalogV1 } from "../lib/market-data/classic-launch-catalog.server";

afterEach(() => vi.useRealTimers());

describe("Classic catalog cache reads", () => {
  it("keeps a shared refresh for other callers and cancels its actual HTTP reads at the origin deadline",async()=>{
    const origin=new AbortController(), caller=new AbortController();
    const nativeTimeout=AbortSignal.timeout.bind(AbortSignal);
    const timeout=vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>ms===45_000?origin.signal:nativeTimeout(ms));
    const wires:AbortSignal[]=[];
    vi.stubGlobal("fetch",(_url:unknown,init:RequestInit)=>new Promise<Response>((_,reject)=>{
      const signal=init.signal!;
      wires.push(signal);
      signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
    }));
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try {
      const first=expect(readClassicLaunchCatalogV1({signal:caller.signal})).rejects.toThrow();
      const second=expect(readClassicLaunchCatalogV1()).rejects.toThrow();
      await vi.waitFor(()=>expect(wires.length).toBeGreaterThan(0));
      caller.abort();await first;
      expect(wires.every(signal=>!signal.aborted)).toBe(true);
      origin.abort();await second;
      expect(wires.every(signal=>signal.aborted)).toBe(true);
      expect(warning).toHaveBeenCalledWith("Classic catalog origin deadline reached",{phase:"anchor",budgetMs:45_000});
    } finally {origin.abort();timeout.mockRestore();warning.mockRestore();vi.unstubAllGlobals();}
  });

  it("reads a full catalog within bounded cache waves without losing or reordering groups", async () => {
    vi.useFakeTimers();
    const groups = Array.from({ length: 67 }, (_, index) => index);
    let active = 0;
    let peak = 0;
    const reads: number[] = [];
    const pending = readClassicCatalogGroups(groups, async group => {
      reads.push(group);
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, group % 8 === 0 ? 100 : 10));
      active--;
      return [group * 2, group * 2 + 1];
    });
    let finished = false;
    void pending.then(() => { finished = true; });

    await vi.advanceTimersByTimeAsync(899);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual(Array.from({ length: 134 }, (_, index) => index));
    expect(reads).toEqual(groups);
    expect(peak).toBe(8);
    expect(active).toBe(0);
  });

  it("propagates a failed group without starting the remaining catalog", async () => {
    const read = vi.fn(async (group: number) => {
      if (group === 2) throw new Error("Unverified group");
      return [group];
    });

    await expect(readClassicCatalogGroups(Array.from({ length: 20 }, (_, index) => index), read))
      .rejects.toThrow("Unverified group");
    expect(read.mock.calls.map(([group]) => group)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
