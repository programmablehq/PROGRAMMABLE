import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const readers = vi.hoisted(() => ({ chain: vi.fn(), catalog: vi.fn() }));
vi.mock("../lib/custom-ai/chain.server", () => ({ customAIChain: readers.chain }));
vi.mock("../lib/server/unified-explore", () => ({ readUnifiedLaunches: readers.catalog }));
import { readLiveKnowledge } from "../lib/custom-ai/knowledge.server";
import { safeKnowledgeSources } from "../lib/custom-ai/knowledge";
import { runCustomAI } from "../lib/custom-ai/service.server";
import { parseRulePlan } from "../lib/custom-ai/rules";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
const lookup = { kind: "web" as const, query: "Current official v4 documentation", chainId: 1 as const, address: "" };
describe("bounded read-only knowledge", () => {
  it("keeps sourced web research separate from structured generation with at most two searches", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    const fetcher = vi.fn(async () => Response.json({ stop_reason: "end_turn", content: [
      { type: "web_search_tool_result", content: [] },
      { type: "text", text: "An official explanation.", citations: [{ title: "Official docs", url: "https://docs.uniswap.org/" }] },
    ] }));
    vi.stubGlobal("fetch", fetcher);
    const result = await readLiveKnowledge(lookup);
    expect(result.sources[0].url).toBe("https://docs.uniswap.org/");
    const sent = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]);
    expect(sent.output_config).toBeUndefined();
  });
  it("does not accept an unsourced model answer as a live lookup", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    vi.stubGlobal("fetch", async () => Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: "Trust me." }] }));
    await expect(readLiveKnowledge(lookup)).rejects.toMatchObject({ code: "lookup" });
  });
  it("drops executable and credential-bearing source URLs", () => {
    const sources = ["javascript:alert(1)", "https://user:secret@example.org/", "data:text/html,hi", "https://docs.uniswap.org/"];
    expect(safeKnowledgeSources(sources.map(url => ({ url, title: "Source", retrievedAt: "2026-10-23" })))).toHaveLength(1);
  });
  it("preserves stale catalog status and avoids inventing a price", async () => {
    readers.catalog.mockResolvedValue({ status: "stale", updatedAt: "2026-10-22", sources: { ethereum: "stale" },
      items: [{ chainId: 1, tokenAddress: "0x1", name: "Example", symbol: "EX" }], presentations: [] });
    const result = await readLiveKnowledge({ ...lookup, kind: "catalog", query: "EX" });
    expect(result.status).toBe("stale");
    expect(result.facts).toMatchObject({ markets: [] });
  });
  it("links matching token identities to their own chain and asks for a shorter oversized lookup", async () => {
    const address = "0x188aF6b5e024a14924FF352BE3DD578AE15D4c9C";
    readers.catalog.mockResolvedValue({ status: "ready", updatedAt: "2026-11-18", sources: {},
      items: [{ chainId: 4663, tokenAddress: address, name: "HEIST", symbol: "HEIST" }], presentations: [] });
    const selected = { ...lookup, kind: "catalog", chainId: 4663 as const };
    const result = await readLiveKnowledge({ ...selected, query: "HEIST" });
    const url = `https://programmable.market/token/${address}?chain=4663`;
    expect(result.sources).toMatchObject([{ url }]);
    expect(result.facts).toMatchObject({ items: [{ address, url }] });
    const tooLong = await readLiveKnowledge({ ...selected, query: "a".repeat(129) });
    expect(tooLong).toMatchObject({ status: "query-too-long", sources: [] });
    expect(readers.catalog).toHaveBeenCalledTimes(1);
  });
  it.each([1,4663,8453,999] as const)("keeps the catalog's requested network%i in the read and source link",async chainId=>{
    readers.catalog.mockResolvedValue({status:"current",updatedAt:"2026-10-31",sources:{},items:[],presentations:[]});
    const result=await readLiveKnowledge({...lookup,kind:"catalog",chainId,query:"example"});
    expect(readers.catalog).toHaveBeenCalledWith(1,"example",{sort:"highest",mode:"all",chain:chainId,matchesOnly:true},6);
    expect(new URL(result.sources[0].url).searchParams.get("chain")).toBe(String(chainId));
  });
  it.each([8453,999] as const)("does not borrow another network's RPC for unavailable contract reads on%i",async chainId=>{
    await expect(readLiveKnowledge({...lookup,kind:"contract",chainId,address:"0x"+"1".repeat(40)})).rejects.toMatchObject({code:"lookup"});
    expect(readers.chain).not.toHaveBeenCalled();
  });
  it("does not expose signing, arbitrary URLs or other operations as lookup tools", () => {
    expect(() => parseRulePlan({ action: "answer", reply: "", memory: "", requirements: [], feeChecks: [], unresolved: [],
      lookups: [{ ...lookup, kind: "sendTransaction" }] })).toThrow();
  });
  it("feeds lookup failures back as unavailable evidence and performs no second lookup round", async () => {
    const plan = { reply: "Checking the documentation.", action: "answer", memory: "", requirements: [], feeChecks: [], unresolved: [], setupPatch: {}, lookups: [lookup] };
    const answer = { ...plan, reply: "I couldn't retrieve a current source.", lookups: [] };
    const call = vi.fn().mockResolvedValueOnce({ text: JSON.stringify(plan) }).mockResolvedValueOnce({ text: JSON.stringify(answer) });
    const read = vi.fn().mockRejectedValue(Error("private provider details"));
    const result = await runCustomAI({ id: "knowledge-test-0001", intent: "chat", messages: [{ role: "user", content: "Look up current docs." }] },
      undefined, { call, compile: vi.fn(), lookup: read });
    expect(result).toMatchObject({ chargedAs: "research", sources: [] });
    expect(call.mock.calls[1][0].system).toContain('"status":"unavailable"');
    expect(call.mock.calls[1][0].system).not.toContain("private provider details");
    expect(read).toHaveBeenCalledTimes(1);
  });
});
