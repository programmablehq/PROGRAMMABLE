import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../lib/custom-ai/store.server", () => ({ productionAIStore: () => ({ projects: { readPublicSource: read } }) }));
import { GET } from "../app/api/custom-ai/source/[id]/route";
const id = "a".repeat(64), url = `https://programmable.market/api/custom-ai/source/${id}`;
const invoke = (request = new Request(url), selected = id) => GET(request, { params: Promise.resolve({ id: selected }) });
beforeEach(() => { read.mockReset(); });
describe("explicit public source download", () => {
  it("cannot select private jobs, identities or another object kind", async () => {
    for (const [request, selected] of [[new Request(url), "../jobs"], [new Request(`${url}?owner=alice`), id], [new Request(url), "A".repeat(64)]] as const)
      expect((await invoke(request, selected)).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
  it("returns only the public store projection as a canonical immutable attachment", async () => {
    const exported = { id: `sha256:${id}`, content: { projectHash: "sha256:source", compilerInput: { language: "Solidity" } } };
    read.mockResolvedValue(exported);
    const response = await invoke();
    expect(response.status).toBe(200); expect(await response.json()).toEqual(exported); expect(read).toHaveBeenCalledExactlyOnceWith(id);
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("cache-control")).toContain("immutable"); expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect((await invoke(new Request(url, { headers: { "if-none-match": `"${id}"` } }))).status).toBe(304);
  });
  it("keeps unpublished source unavailable and storage failures uncached", async () => {
    read.mockResolvedValue(null); expect((await invoke()).status).toBe(404);
    read.mockRejectedValue(Error("private connection detail")); const response = await invoke();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private connection detail");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
