import { describe, expect, it } from "vitest";
import { launchShareCoinHref, launchShareHref, launchShareIdentity, launchShareIntent, launchShareMetadata, launchSharePost, launchShareText } from "@/lib/launch-share";

const address = `0x${"a".repeat(40)}`;
describe("launch share identity", () => {
  it("keeps coin and chain explicit and rejects ambiguous or external links", () => {
    expect(launchShareIdentity(address, "1")).toEqual({ address, chainId: 1 });
    expect(launchShareHref(`/token/${address}?chain=1`)).toBe(`/share/${address}?chain=1`);
    expect(launchShareHref(`/modules/${address}?transaction=0x123`)).toBe(`/share/${address}?chain=4663`);
    expect(launchShareHref(`/modules/${address}?chainId=1`)).toBe(`/share/${address}?chain=1`);
    for (const href of [`https://other.example/token/${address}?chain=1`, `//other.example/token/${address}?chain=1`,
      `/token/${address}`, `/token/${address}?chain=1&chainId=4663`, `/token/${address}?chain=123`, `/token/not-a-token?chain=1`]) expect(launchShareHref(href)).toBeNull();
    expect(launchShareIdentity(`0x${"0".repeat(40)}`, "1")).toBeNull();
  });
  it("uses only the canonical coin link and cleans untrusted display text", () => {
    const data = { address, chainId: 4663 as const, name: "ROBINHOOK", symbol: "$ROBIN", description: "", href: "https://other.example/", imageDataUrl: null };
    const intent = new URL(launchShareIntent(data));
    expect(intent.origin).toBe("https://twitter.com");
    expect(intent.searchParams.get("url")).toBe(launchShareCoinHref(data));
    expect(intent.searchParams.get("text")).toBe(launchSharePost(data));
    expect(launchSharePost(data)).toContain(`CA: ${address}`);
    expect(launchSharePost(data)).not.toContain("Robinhood Chain");
    expect(launchSharePost(data)).not.toContain("other.example");
    expect(launchSharePost(data)).not.toContain("$$");
    expect(launchShareText("<b>Name</b>\u202e\n test", 32)).toBe("Name test");
    expect(Array.from(launchShareText("😀".repeat(40), 12))).toHaveLength(12);
  });
  it("binds public social previews to the same token and explicit chain", () => {
    const data = launchShareMetadata({ address, chainId: 1 }, "Example", "EX");
    expect(data.openGraph.url).toBe(launchShareCoinHref({ address, chainId: 1 }));
    expect(data.twitter.card).toBe("summary_large_image");
    expect(data.openGraph.images[0].url).toBe(data.twitter.images[0]);
    const image = new URL(data.twitter.images[0]);
    expect(image.searchParams.get("address")).toBe(address);
    expect(image.searchParams.get("chain")).toBe("1");
    expect(launchShareMetadata({ address, chainId: 4663 }, "Example", "EX").twitter.images[0]).not.toBe(data.twitter.images[0]);
  });
});
