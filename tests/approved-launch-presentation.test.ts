import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const storage = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), list: vi.fn() }));
const nextCache = vi.hoisted(() => ({
  entries: new Map<string, { value: unknown; tags: string[] }>(),
  revalidateTag: vi.fn(), after: vi.fn(),
}));
vi.mock("@vercel/blob", () => storage);
vi.mock("next/server", () => ({ after: nextCache.after }));
vi.mock("next/cache", () => ({
  unstable_cache: (read: () => Promise<unknown>, key: string[], options: { tags: string[] }) => async () => {
    const id = JSON.stringify(key), existing = nextCache.entries.get(id);
    if (existing) return existing.value;
    const value = await read(); nextCache.entries.set(id, { value, tags: options.tags });
    return value;
  },
  revalidateTag: nextCache.revalidateTag }));
import { approvedLaunchPresentationFromReview, readApprovedLaunchPresentations, rememberApprovedLaunchPresentation, rememberApprovedLaunchResource } from "@/lib/server/approved-launch-presentation";

const token = `0x${"11".repeat(20)}`, hook = `0x${"22".repeat(20)}`, creator = `0x${"33".repeat(20)}`, quote = `0x${"00".repeat(20)}`;
const review = { schemaVersion: "programmable.custom-launch-manual-review.v1", reviewId: "10000000-0000-4000-8000-000000000001",
  subjectHash: `sha256:${"a".repeat(64)}`, chainId: "4663", controller: creator, state: "approved", revision: 2,
  submittedAt: "2026-10-14T00:00:00Z", approvedAt: "2026-10-14T01:00:00Z", expiresAt: "2026-10-15T01:00:00Z", reason: null,
  request: { schemaVersion: "programmable.custom-launch-plan.v1", chainId: "4663", controller: { address: creator },
    publication: { name: "Coin", symbol: "COIN", visibility: "listed", primaryComponentId: "coin", primaryMarketId: "pool",
      imageUrl: "https://project.example/logo.png", description: "Approved project", links: ["https://x.com/project", "https://project.example"] },
    components: [{ componentId: "coin", expectedAddress: token }, { componentId: "hook", expectedAddress: hook }],
    markets: [{ marketId: "pool", kind: "uniswap_v4", currency0: { address: quote }, currency1: { componentId: "coin" }, hooks: { componentId: "hook" }, fee: 0, tickSpacing: 60 }] } };
const files = new Map<string,string>();
beforeEach(() => {
  vi.stubEnv("OPS_BLOB_READ_WRITE_TOKEN","test-blob-token");
  files.clear(); vi.clearAllMocks();
  nextCache.entries.clear();
  nextCache.revalidateTag.mockImplementation((tag: string) => {
    for (const [key, value] of nextCache.entries) if (value.tags.includes(tag)) nextCache.entries.delete(key);
  });
  storage.get.mockImplementation(async (key: string) => files.has(key) ? { statusCode: 200, blob: { etag: `"${"0".repeat(32)}"` },
    stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(files.get(key)!)); controller.close(); } }) } : null);
  storage.put.mockImplementation(async (key: string, body: string) => { files.set(key,body); return {}; });
  storage.list.mockImplementation(async ({ prefix }: { prefix: string }) => ({
    hasMore: false, blobs: [...files.keys()].filter(key => key.startsWith(prefix)).map(pathname => ({ pathname })),
  }));
});

function explorePage() {
  const row = approvedLaunchPresentationFromReview(review)!;
  return [row, ...[1, 2, 3, 4, 5].map(n => ({ ...row, tokenAddress: `0x${String(n).padStart(40, "0")}` }))];
}

describe("approved public launch presentation", () => {
  it("skips missing objects on a page and makes a new approval visible to another instance", async () => {
    const page = explorePage();
    expect((await readApprovedLaunchPresentations(page)).size).toBe(0);
    expect(storage.list).toHaveBeenCalledTimes(1);
    expect(storage.get).not.toHaveBeenCalled();
    await rememberApprovedLaunchPresentation(review);
    storage.get.mockClear();
    vi.resetModules();
    const other = await import("@/lib/server/approved-launch-presentation");
    expect((await other.readApprovedLaunchPresentations(page)).get(token)?.imageUrl).toBe(page[0].imageUrl);
    expect(storage.list).toHaveBeenCalledTimes(2);
    expect(storage.get).toHaveBeenCalledTimes(1);
  });

  it.each(["partial", "unavailable"])("reads exact records when the directory is %s", async reason => {
    const page = explorePage();
    await rememberApprovedLaunchPresentation(review);
    storage.get.mockClear();
    if (reason === "partial") storage.list.mockResolvedValueOnce({ hasMore: true, blobs: [] });
    else storage.list.mockRejectedValueOnce(new Error("storage offline"));
    expect((await readApprovedLaunchPresentations(page)).get(token)?.imageUrl).toBe(page[0].imageUrl);
    expect(storage.get).toHaveBeenCalledTimes(page.length);
  });

  it("recovers a cold exact read immediately after a temporary origin error", async () => {
    const row = approvedLaunchPresentationFromReview(review)!;
    await rememberApprovedLaunchPresentation(review);
    storage.get.mockRejectedValueOnce(new Error("temporary storage timeout"));
    expect((await readApprovedLaunchPresentations([row])).size).toBe(0);
    expect((await readApprovedLaunchPresentations([row])).get(token)?.imageUrl).toBe(row.imageUrl);
    expect(storage.list).not.toHaveBeenCalled();
  });

  it("shares a slow origin read across requests and finishes caching after the display deadline", async () => {
    const row = approvedLaunchPresentationFromReview(review)!;
    await rememberApprovedLaunchPresentation(review);
    const get = storage.get.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    storage.get.mockClear().mockImplementation(async (...args) => { await gate; return get(...args); });
    vi.useFakeTimers();
    try {
      const first = readApprovedLaunchPresentations([row]);
      const second = readApprovedLaunchPresentations([row]);
      await vi.advanceTimersByTimeAsync(1500);
      expect((await first).size).toBe(0);
      expect((await second).size).toBe(0);
      expect(storage.get).toHaveBeenCalledTimes(1);
      expect(nextCache.after).toHaveBeenCalledTimes(2);
      release();
      await Promise.all(nextCache.after.mock.calls.map(([finish]) => finish()));
      expect((await readApprovedLaunchPresentations([row])).get(token)?.imageUrl).toBe(row.imageUrl);
      expect(storage.get).toHaveBeenCalledTimes(1);
    } finally { release(); vi.useRealTimers(); }
  });

  it("releases stalled origin reads after the response and recovers the same identity", async () => {
    const row = approvedLaunchPresentationFromReview(review)!;
    await rememberApprovedLaunchPresentation(review);
    storage.get.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const result = readApprovedLaunchPresentations([row]);
      await vi.advanceTimersByTimeAsync(1500);
      expect((await result).size).toBe(0);
      const background = nextCache.after.mock.calls[0]![0]();
      await vi.advanceTimersByTimeAsync(5000);
      await background;
      expect((await readApprovedLaunchPresentations([row])).get(token)?.imageUrl).toBe(row.imageUrl);
    } finally { vi.useRealTimers(); }
  });

  it("shares missing lookups across server instances and refreshes the exact entry after approval", async () => {
    const otherCreator = `0x${"77".repeat(20)}`;
    const otherReview = { ...review, controller: otherCreator,
      request: { ...review.request, controller: { address: otherCreator } } };
    const row = approvedLaunchPresentationFromReview(otherReview)!;
    expect((await readApprovedLaunchPresentations([row])).size).toBe(0);
    expect(storage.get).toHaveBeenCalledTimes(1);
    vi.resetModules();
    const freshInstance = await import("@/lib/server/approved-launch-presentation");
    expect((await freshInstance.readApprovedLaunchPresentations([row])).size).toBe(0);
    expect(storage.get).toHaveBeenCalledTimes(1);
    await freshInstance.rememberApprovedLaunchPresentation(otherReview);
    expect(nextCache.revalidateTag).toHaveBeenCalledWith(expect.stringMatching(/^approved-presentation:/), { expire: 0 });
    expect((await freshInstance.readApprovedLaunchPresentations([row])).get(token)?.imageUrl)
      .toBe("https://project.example/logo.png");
  });
  it("copies only public display fields and resolves the approved pool's exact components", () => {
    const row = approvedLaunchPresentationFromReview(review)!;
    expect(row).toMatchObject({ chainId: 4663, tokenAddress: token, hookAddress: hook, creator,
      imageUrl: "https://project.example/logo.png", description: "Approved project",
      links: [{ label: "X", url: "https://x.com/project" }, { label: "Website", url: "https://project.example/" }] });
    expect(row.poolId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(row).not.toHaveProperty("request"); expect(row).not.toHaveProperty("reason");
  });
  it.each(["pending","rejected","expired"])("does not capture a %s review", state => {
    expect(approvedLaunchPresentationFromReview({ ...review,state })).toBeNull();
  });
  it("rejects unlisted projects, wrong controllers and a primary token outside the reviewed market", () => {
    expect(approvedLaunchPresentationFromReview({ ...review,request: { ...review.request,controller:{address:hook} } })).toBeNull();
    expect(approvedLaunchPresentationFromReview({ ...review,request: { ...review.request,publication:{...review.request.publication,visibility:"unlisted"} } })).toBeNull();
    expect(approvedLaunchPresentationFromReview({ ...review,request: { ...review.request,markets: [{...review.request.markets[0],currency1:{address:creator}}] } })).toBeNull();
  });
  it("never exposes credentials or private-network URLs in images and links", () => {
    const row = approvedLaunchPresentationFromReview({ ...review,request: { ...review.request,publication: {
      ...review.request.publication,imageUrl:"https://127.0.0.1/private.png",links:["https://project.example/?api_key=private-value", "https://localhost/", "https://user:password@project.example/"] } } })!;
    expect(row.imageUrl).toBeNull(); expect(row.links).toEqual([]);
  });
  it("persists privately and serves only the matching chain/token/hook/pool/controller", async () => {
    const row = approvedLaunchPresentationFromReview(review)!;
    await rememberApprovedLaunchPresentation(review);
    expect(storage.put).toHaveBeenCalledWith(expect.any(String),expect.any(String),expect.objectContaining({ access:"private" }));
    expect(await readApprovedLaunchPresentations([row])).toEqual(new Map([[token,{imageUrl:row.imageUrl,description:row.description,links:row.links}]]));
    expect((await readApprovedLaunchPresentations([{...row,chainId:1},{...row,hookAddress:creator},{...row,creator:hook}])).size).toBe(0);
  });
  it("binds legacy Ethereum presentation to its actual Router launch ID", async () => {
    const legacy = { ...review,chainId:"1",request: { projectMetadataHash:`sha256:${"b".repeat(64)}`,
      projectMetadata:{presentation:{image:{uri:"https://project.example/eth.png"},description:"Ethereum",links:[{kind:"x",uri:"https://x.com/project"}]}} },
      technicalStatus:{result:{artifact:{schemaVersion:"programmable.prepared-custom-graph-launch.v1", chainBindings:{chainId:"1"},
        projectMetadataHash:`sha256:${"b".repeat(64)}`,stampRequest:{token,launchId:`0x${"ab".repeat(32)}`,
          poolKey:{currency0:quote,currency1:token,hooks:hook,fee:0,tickSpacing:60}}}}} };
    const row = approvedLaunchPresentationFromReview(legacy)!;
    await rememberApprovedLaunchResource({ schemaVersion:"programmable.custom-launch.v3",manualReview:review,
      ownerWallet:hook,projectMetadata:legacy.request.projectMetadata,projectMetadataHash:legacy.request.projectMetadataHash,
      output:legacy.technicalStatus.result });
    expect(storage.put).not.toHaveBeenCalled();
    await rememberApprovedLaunchResource({ schemaVersion:"programmable.custom-launch.v3",manualReview:{...review,chainId:"1"},
      ownerWallet:creator,projectMetadata:legacy.request.projectMetadata,projectMetadataHash:legacy.request.projectMetadataHash,
      output:legacy.technicalStatus.result });
    expect((await readApprovedLaunchPresentations([{...row,launchId:row.routerLaunchId!}])).get(token)?.imageUrl).toBe("https://project.example/eth.png");
    expect((await readApprovedLaunchPresentations([{...row,launchId:`0x${"cd".repeat(32)}`}])).size).toBe(0);
  });
  it("keeps optional storage outages from blocking a coin's existing presentation", async () => {
    storage.get.mockRejectedValue(new Error("temporary storage failure"));
    const row = approvedLaunchPresentationFromReview(review)!;
    expect(await readApprovedLaunchPresentations([{...row,creator:`0x${"44".repeat(20)}`}])).toEqual(new Map());
  });
});
