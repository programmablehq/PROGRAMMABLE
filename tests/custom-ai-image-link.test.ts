import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { imageFromLink } from "../lib/custom-ai/image-link.server";
import { verifyTokenImageWebpV1 } from "../lib/server/token-image-webp-v1";

describe("owned coin-image URL import", () => {
  it("turns one fetched raster into the same verified image format as an upload", async () => {
    const png = await sharp({ create: { width: 12, height: 8, channels: 4, background: "#ce82af" } }).png().toBuffer();
    const read = vi.fn(async () => `data:image/png;base64,${png.toString("base64")}`);
    const image = await imageFromLink({ url: "https://images.example.org/coin.png" }, read);
    expect(read).toHaveBeenCalledExactlyOnceWith("https://images.example.org/coin.png");
    expect(await verifyTokenImageWebpV1(image)).toMatchObject({ width: 1000, height: 1000 });
  });
  it("rejects ambiguous inputs, credentials and non-HTTPS URLs before fetching", async () => {
    const read = vi.fn();
    for (const input of [null, [], { url: "file:///etc/passwd" }, { url: "http://example.org/coin.png" },
      { url: "https://user:pass@example.org/coin.png" }, { url: "https://example.org:444/coin.png" },
      { url: "https://example.org/coin.png#secret" }, { url: "https://example.org/coin.png", owner: "someone-else" }]) {
      await expect(imageFromLink(input, read)).rejects.toMatchObject({ code: "image", status: 422 });
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("does not accept failed fetches, SVG or malformed raster bytes", async () => {
    for (const result of [null, "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,ZmFrZQ==",
      `data:image/png;base64,${Buffer.alloc(1_048_577).toString("base64")}`]) {
      await expect(imageFromLink({ url: "https://images.example.org/coin.png" }, async () => result)).rejects.toMatchObject({ code: "image", status: 422 });
    }
  });
});
