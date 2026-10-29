import { describe, expect, it } from "vitest";
import { budgetIndexProvider } from "@/lib/server/robinhood-index/provider-budget";

function clock() {
  let time = 0;
  return { now: () => time, wait: async (ms: number, signal: AbortSignal) => { signal.throwIfAborted(); time += ms; } };
}
describe("per-operation Foundation RPC budget", () => {
  it("paces parallel reads and only coalesces repeated pinned calls", async () => {
    const timing = clock(), starts: number[] = [];
    const request = budgetIndexProvider(async () => { starts.push(timing.now()); return "0x1234"; }, new AbortController().signal, timing);
    const pinned = { method: "eth_call", params: [{ to: "0x1234", data: "0x00" }, "0x123"] };
    expect(await Promise.all([request(pinned), request(pinned)])).toEqual(["0x1234", "0x1234"]);
    await Promise.all([request({ method: "eth_chainId" }), request({ method: "eth_getBlockByNumber", params: ["0x123"] })]);
    expect(starts).toEqual([0, 250, 500]);
    await request(pinned);
    expect(starts).toHaveLength(3);
  });
  it("does not cache moving anchors, latest calls, logs, failures or empty code", async () => {
    let calls = 0;
    const request = budgetIndexProvider(async () => { calls++; return "0x"; }, new AbortController().signal, clock());
    for (const args of [{ method: "eth_getBlockByNumber", params: ["0x123"] }, { method: "eth_getLogs", params: [{}] },
      { method: "eth_call", params: [{}, "latest"] }, { method: "eth_getCode", params: ["0x1234", "0x123"] }]) {
      await request(args); await request(args);
    }
    expect(calls).toBe(8);
    let failures = 0;
    const retry = budgetIndexProvider(async () => { failures++; throw new Error("unavailable"); }, new AbortController().signal, clock());
    const args = { method: "eth_call", params: [{}, "0x123"] };
    await expect(retry(args)).rejects.toThrow("unavailable");
    await expect(retry(args)).rejects.toThrow("unavailable");
    expect(failures).toBe(2);
  });
  it("reuses one checkpoint within the operation and reads changed checkpoints again", async () => {
    let calls = 0;
    const request = budgetIndexProvider(async () => { calls++; return "0x1234"; }, new AbortController().signal, clock());
    for (let range = 0; range < 20; range++) {
      for (let contract = 0; contract < 10; contract++) {
        await request({ method: "eth_call", params: [{ to: `contract-${contract}` }, "0x123"] });
      }
    }
    expect(calls).toBe(10);
    await request({ method: "eth_call", params: [{ to: "contract-0" }, "0x124"] });
    expect(calls).toBe(11);
  });
  it("keeps providers and operations independent and cancels queued work", async () => {
    let calls = 0;
    const controller = new AbortController();
    const args = { method: "eth_getCode", params: ["0x1234", "0x123"] };
    const request = budgetIndexProvider(async () => { calls++; controller.abort(); return "0x1234"; }, controller.signal, clock());
    const first = request(args), queued = request({ method: "eth_chainId" });
    await first;
    await expect(queued).rejects.toThrow();
    await expect(request(args)).rejects.toThrow();
    const independent = budgetIndexProvider(async () => { calls++; return "0x5678"; }, new AbortController().signal, clock());
    expect(await independent(args)).toBe("0x5678");
    expect(calls).toBe(2);
  });
});
