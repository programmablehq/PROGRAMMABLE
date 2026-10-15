import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), get: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ get: mocks.get }));
import { publicShareImageAddress, readLaunchShareImage, shareImageType } from "@/lib/server/launch-share-image";

const png = Buffer.from([137,80,78,71,13,10,26,10]);
beforeEach(() => { vi.clearAllMocks(); });
describe("public launch logo retrieval", () => {
  it("never fetches private, credentialed or redirected source identities", async () => {
    for (const url of ["http://example.com/a.png", "https://127.0.0.1/a.png", "https://user:pass@example.com/a.png", "https://example.com:8443/a.png", "https://localhost/a.png"]) expect(await readLaunchShareImage(url)).toBeNull();
    expect(mocks.lookup).not.toHaveBeenCalled();
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    expect(await readLaunchShareImage("https://example.com/a.png")).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
    for (const address of ["0.0.0.0", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "::1"]) expect(publicShareImageAddress(address)).toBe(false);
  });
  it("pins a public address, requires a raster signature and refuses redirects", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const respond = (status: number, type: string, body: Buffer) => mocks.get.mockImplementation((_url, options, callback) => {
      options.lookup("example.com", {}, (_err: unknown, ip: string) => expect(ip).toBe("8.8.8.8"));
      const response = Object.assign(new PassThrough(), { statusCode: status, headers: { "content-type": type } });
      queueMicrotask(() => { callback(response); response.end(body); }); return new EventEmitter();
    });
    respond(200, "image/png", png);
    expect(await readLaunchShareImage("https://example.com/a.png")).toBe(`data:image/png;base64,${png.toString("base64")}`);
    respond(302, "image/png", png);
    expect(await readLaunchShareImage("https://example.com/a.png")).toBeNull();
    respond(200, "image/png", Buffer.from("<svg/>"));
    expect(await readLaunchShareImage("https://example.com/a.png")).toBeNull();
    respond(200, "image/png", Buffer.concat([png, Buffer.alloc(1_048_576)]));
    expect(await readLaunchShareImage("https://example.com/a.png")).toBeNull();
    expect(shareImageType(Buffer.from("<svg/>"))).toBeNull();
  });
});
