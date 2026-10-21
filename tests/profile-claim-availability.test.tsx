import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileLaunchRewards } from "@/components/profile-launch-rewards";
import type { Launch } from "@/components/robinhood-launches-view";
import { UnifiedProfileLaunches } from "@/components/robinhood-launches-view";
const account = `0x${"11".repeat(20)}`;
const token = `0x${"22".repeat(20)}`;
const launch = { tokenAddress: token, creator: account, mode: "custom", name: "Custom hook" } as Launch;

it("keeps the owner's verified rewards accessible before any launch rows are available", () => {
  const html = renderToStaticMarkup(<UnifiedProfileLaunches account={account} launchChainId={1}
    enableClaims onAllRewards={() => {}} />);
  expect(html).toContain("Loading launches");
  expect(html).toMatch(/<button type="button"[^>]*>Claim rewards<\/button>/);
});

it("does not offer all rewards on a public profile or without a claim dialog", () => {
  const publicProfile = renderToStaticMarkup(<UnifiedProfileLaunches account={account} launchChainId={1}
    onAllRewards={() => {}} />);
  const noDialog = renderToStaticMarkup(<UnifiedProfileLaunches account={account} launchChainId={1} enableClaims />);
  expect(publicProfile).not.toContain("Claim rewards");
  expect(noDialog).not.toContain("Claim rewards");
});

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
