import { describe, expect, it } from "vitest";
import { launchShareCoinHref, launchShareHref, launchShareIdentity, launchSharePost, launchShareText } from "@/lib/launch-share";

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
    expect(launchSharePost(data)).toContain(launchShareCoinHref(data));
    expect(launchSharePost(data)).not.toContain("other.example");
    expect(launchSharePost(data)).not.toContain("$$");
    expect(launchShareText("<b>Name</b>\u202e\n test", 32)).toBe("Name test");
    expect(Array.from(launchShareText("😀".repeat(40), 12))).toHaveLength(12);
  });
});
