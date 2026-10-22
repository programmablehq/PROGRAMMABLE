import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import {
  applyTokenImageFallback,
  canOptimizeTokenImage,
  getProgrammableTokenImageAssetName,
  getTokenCardImageSource,
  getTokenImageFileError,
  isProgrammableTokenImageUrl,
  MAX_TOKEN_IMAGE_UPLOAD_BYTES,
  PROGRAMMABLE_TOKEN_IMAGE_HOST,
  readTokenImageUploadResponse,
} from "../lib/token-image";
import {
  inspectWebpStructure,
  verifyTokenImageWebpV1,
} from "../lib/server/token-image-webp-v1";
import nextConfig, { sharpRuntimeFiles } from "../next.config";

describe("token image policy", () => {
  it("traces the native Sharp runtime into every image-processing route", () => {
    expect(sharpRuntimeFiles).toEqual([
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
    ]);
    expect(nextConfig.outputFileTracingIncludes).toMatchObject({
      "/api/custom-ai/image": sharpRuntimeFiles,
      "/api/token-image": sharpRuntimeFiles,
      "/api/prediction/asset-logo/*": sharpRuntimeFiles,
      "/api/profile/projects/*/article/media": sharpRuntimeFiles,
    });
  });

  it("keeps prepared uploads within the card-performance budget", () => {
    expect(MAX_TOKEN_IMAGE_UPLOAD_BYTES).toBe(1_000_000);
  });

  it("accepts supported files within the source limit", () => {
    expect(
      getTokenImageFileError({
        size: 250_000,
        type: "image/png",
      }),
    ).toBe("");
  });

  it("accepts phone photos and file providers without MIME metadata", () => {
    expect(getTokenImageFileError({ name: "IMG_1234.HEIC", type: "image/heic", size: 12_000_000 })).toBe("");
    expect(getTokenImageFileError({ name: "photo.JPG", type: "", size: 1_000_000 })).toBe("");
    expect(getTokenImageFileError({ name: "photo.png", type: "application/octet-stream", size: 1_000_000 })).toBe("");
    expect(getTokenImageFileError({ name: "photo.svg", type: "", size: 100 })).not.toBe("");
    expect(getTokenImageFileError({ name: "photo.jpg", type: "image/svg+xml", size: 100 })).not.toBe("");
  });

  it("rejects unsupported and oversized source files", () => {
    expect(
      getTokenImageFileError({
        size: 250_000,
        type: "image/svg+xml",
      }),
    ).toContain("JPG");
    expect(
      getTokenImageFileError({
        size: 20_000_001,
        type: "image/webp",
      }),
    ).toContain("smaller than 20 MB");
  });

  it("fully decodes only a structurally valid 1000 by 1000 WebP", async () => {
    const webp = await sharp({
      create: {
        width: 1_000,
        height: 1_000,
        channels: 4,
        background: { r: 21, g: 32, b: 43, alpha: 1 },
      },
    }).webp().toBuffer();
    await expect(verifyTokenImageWebpV1(webp)).resolves.toMatchObject({
      width: 1_000,
      height: 1_000,
    });
    expect(inspectWebpStructure(webp)).toEqual({ width: 1_000, height: 1_000 });
  });

  it("rejects JPEG and PNG bytes relabelled as WebP", async () => {
    const jpeg = await sharp({
      create: {
        width: 1_000,
        height: 1_000,
        channels: 3,
        background: { r: 21, g: 32, b: 43 },
      },
    }).jpeg().toBuffer();
    const png = await sharp({
      create: {
        width: 1_000,
        height: 1_000,
        channels: 3,
        background: { r: 21, g: 32, b: 43 },
      },
    }).png().toBuffer();
    await expect(verifyTokenImageWebpV1(jpeg)).rejects.toThrow("WebP");
    await expect(verifyTokenImageWebpV1(png)).rejects.toThrow("WebP");
  });

  it("rejects wrong dimensions, broken RIFF lengths and corrupt image bytes", async () => {
    const wrongDimensions = await sharp({
      create: {
        width: 999,
        height: 1_000,
        channels: 3,
        background: { r: 21, g: 32, b: 43 },
      },
    }).webp().toBuffer();
    const valid = await sharp({
      create: {
        width: 1_000,
        height: 1_000,
        channels: 3,
        background: { r: 21, g: 32, b: 43 },
      },
    }).webp().toBuffer();
    const brokenLength = Uint8Array.from(valid);
    brokenLength[4] = (brokenLength[4]! + 1) & 0xff;
    const corrupt = valid.subarray(0, valid.byteLength - 3);
    await expect(verifyTokenImageWebpV1(wrongDimensions)).rejects.toThrow("1000");
    await expect(verifyTokenImageWebpV1(brokenLength)).rejects.toThrow("WebP");
    await expect(verifyTokenImageWebpV1(corrupt)).rejects.toThrow("WebP");
  });

  it("optimizes only local token images", () => {
    expect(canOptimizeTokenImage("/brand/token.webp")).toBe(true);
    expect(
      canOptimizeTokenImage(
        "https://k2uoipt9wchjtz3h.public.blob.vercel-storage.com/token-images/example.webp",
      ),
    ).toBe(false);
    expect(
      canOptimizeTokenImage("https://programmable.family/token.webp"),
    ).toBe(false);
    expect(canOptimizeTokenImage("//example.com/token.webp")).toBe(false);
  });

  it("routes only the Programmable image store through local optimization", () => {
    const image =
      `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/example.webp`;
    expect(isProgrammableTokenImageUrl(image)).toBe(true);
    expect(getProgrammableTokenImageAssetName(image)).toBe("example.webp");
    expect(getTokenCardImageSource(image)).toBe(
      "/api/token-image-proxy/example.webp",
    );
    expect(
      isProgrammableTokenImageUrl(
        "https://example.com/token-images/example.webp",
      ),
    ).toBe(false);
    expect(
      isProgrammableTokenImageUrl(
        `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}.example.com/token-images/example.webp`,
      ),
    ).toBe(false);
    expect(isProgrammableTokenImageUrl(`${image}?version=2`)).toBe(false);
    expect(isProgrammableTokenImageUrl(`${image}#replacement`)).toBe(false);
    expect(
      getTokenCardImageSource("https://example.com/token.webp"),
    ).toBe("https://example.com/token.webp");
    expect(
      getProgrammableTokenImageAssetName(
        `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/nested/example.webp`,
      ),
    ).toBe("");
  });

  it("replaces a failed external image with one inert local fallback", () => {
    const removed: string[] = [];
    const image = {
      alt: "Broken token artwork",
      dataset: {} as DOMStringMap,
      src: "https://example.com/broken.webp",
      removeAttribute(name: string) {
        removed.push(name);
      },
    } as unknown as HTMLImageElement;

    expect(applyTokenImageFallback(
      image,
      "/brand/programmable-token-fallback-01-dawn.webp",
    )).toBe(true);
    expect(image).toMatchObject({
      alt: "",
      src: "/brand/programmable-token-fallback-01-dawn.webp",
      dataset: { tokenImageFallback: "true" },
    });
    expect(removed).toEqual(["srcset"]);
    expect(applyTokenImageFallback(
      image,
      "/brand/programmable-token-fallback-02-moon.webp",
    )).toBe(false);
    expect(image.src).toBe(
      "/brand/programmable-token-fallback-01-dawn.webp",
    );
  });

  it.each([
    [500, "text/html; charset=utf-8", "<!DOCTYPE html>"],
    [404, "text/html", "<html>Not found</html>"],
    [200, "text/plain", JSON.stringify({ url: "https://example.com/image.webp" })],
    [500, "application/json", "{broken"],
  ])("rejects non-JSON upload responses without leaking parser errors", async (
    status,
    contentType,
    body,
  ) => {
    const response = new Response(body, {
      status,
      headers: { "content-type": contentType },
    });
    await expect(readTokenImageUploadResponse(response)).resolves.toBeNull();
  });

  it("preserves valid upload errors and success responses", async () => {
    const rejected = new Response(JSON.stringify({
      error: "Connect your wallet and try again",
    }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    await expect(readTokenImageUploadResponse(rejected)).resolves.toEqual({
      error: "Connect your wallet and try again",
    });

    const url = `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/token-images/example.webp`;
    const accepted = new Response(JSON.stringify({ url }), {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    await expect(readTokenImageUploadResponse(accepted)).resolves.toEqual({ url });
  });
});
