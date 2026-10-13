import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileLaunchRewards } from "@/components/profile-launch-rewards";
import type { Launch } from "@/components/robinhood-launches-view";
const account = `0x${"11".repeat(20)}`;
const token = `0x${"22".repeat(20)}`;
const launch = { tokenAddress: token, creator: account, mode: "custom", name: "Custom hook" } as Launch;

it("does not promise a universal claim for an arbitrary Ethereum hook", () => {
  expect(renderToStaticMarkup(<ProfileLaunchRewards launch={launch} account={account} chainId={1} />)).toBe("");
});
it("offers the independently verified module path only to the launch creator", () => {
  const moduleLaunch: Launch = { ...launch, mode: "module", foundationClaim: {
    tokenAddress: token, creator: account, hookAddress: `0x${"33".repeat(20)}`,
    quoteAsset: `0x${"44".repeat(20)}`, poolId: `0x${"55".repeat(32)}`, sourceReleaseDigest: `0x${"66".repeat(32)}`,
  } };
  expect(renderToStaticMarkup(<ProfileLaunchRewards launch={moduleLaunch} account={account} chainId={1} />)).toContain("Claim rewards");
  expect(renderToStaticMarkup(<ProfileLaunchRewards launch={moduleLaunch} account={token} chainId={1} />)).toBe("");
});
