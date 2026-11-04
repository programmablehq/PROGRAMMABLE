import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({authorize: vi.fn(), read: vi.fn(), consume: vi.fn()}));
vi.mock("../lib/custom-ai/auth.server", () => ({authorizeCustomAI: mock.authorize}));
vi.mock("../lib/custom-ai/product/action-service.server", () => ({createProductValueReader: () => mock.read}));
vi.mock("../lib/custom-ai/product/runtime-production.server", () => ({readProductionProductRuntime: vi.fn()}));
vi.mock("../lib/custom-ai/store.server", () => ({productionAIStore: () => ({consume: mock.consume})}));
import {GET} from "../app/api/custom-ai/product-value/route";
const id = "product-preparation-0001", auth = {kind: "account", owner: "private-owner"};
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED", "true");
  mock.authorize.mockResolvedValue(auth); mock.read.mockResolvedValue({value: {state: "value-observed"}, runtime: {}});
});
afterEach(() => vi.unstubAllEnvs());
describe("private contract values API", () => {
  it("uses the signed-in account and has no public cache", async () => {
    const request = new Request(`https://site.test/api/custom-ai/product-value?id=${id}&action=inspect`), response = await GET(request);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mock.authorize).toHaveBeenCalledWith(request, false, true); expect(mock.read).toHaveBeenCalledWith(request, auth, id, "inspect");
    expect(mock.consume).toHaveBeenCalledWith("private-owner", "product-value-read", 30);
    expect(await response.json()).toEqual({value: {state: "value-observed"}, runtime: {}});
  });
  it("rejects bulk calls and caller-controlled addresses or arguments", async () => {
    for (const query of ["", `id=${id}&action=inspect&action=inspect`, `id=${id}&action=inspect&caller=0x1234`, `id=${id}&action=inspect&arguments=[]`])
      expect((await GET(new Request(`https://site.test/api/custom-ai/product-value?${query}`))).status).toBe(400);
    mock.authorize.mockResolvedValue({kind: "preview"});
    expect((await GET(new Request(`https://site.test/api/custom-ai/product-value?id=${id}&action=inspect`))).status).toBe(401);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("respects the existing availability switch", async () => {
    vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED", "false");
    expect((await GET(new Request(`https://site.test/api/custom-ai/product-value?id=${id}&action=inspect`))).status).toBe(404);
    expect(mock.authorize).not.toHaveBeenCalled();
  });
});
