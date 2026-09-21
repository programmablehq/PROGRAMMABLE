import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LaunchPairModules } from "@/components/launch-pair-modules";
import { launchPresentationDetails, type LaunchPresentationSource } from "@/lib/launch-presentation-details";
import type { PublicModuleDetails } from "@/lib/module-mode/public-details";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const native = address("0"), weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const launch: LaunchPresentationSource = { tokenAddress: address("1"), poolId: hash("2") };

describe("canonical launch pair and module presentation", () => {
  it("shows source-bound pair identities and never guesses a missing pair", () => {
    expect(launchPresentationDetails(launch, 4663).pair).toBeNull();
    expect(launchPresentationDetails({ ...launch, sourceKind: "module-native-v2" }, 4663).pair).toEqual({ address: native, label: "ETH" });
    expect(launchPresentationDetails({ ...launch, sourceKind: "module-native-v2" }, 1).pair).toBeNull();
    expect(launchPresentationDetails({ ...launch, sourceKind: "module-foundation-v1", quoteAsset: weth }, 4663))
      .toEqual({ pair: { address: weth, label: "WETH" }, modules: [], moduleCount: 0 });
    const another = launchPresentationDetails({ ...launch, sourceKind: "module-foundation-v1", quoteAsset: address("3") }, 4663);
    expect(another.pair).toEqual({ address: address("3"), label: "0x3333…3333" });
    expect(another.modules).toEqual(["Pair another token"]);
    expect(another.moduleCount).toBe(1);
  });

  it("accepts only the same pool's quote observation and preserves the canonical quote on disagreement", () => {
    const market = { poolId: launch.poolId!, quoteAsset: { address: address("3"), symbol: "QUOTE" } };
    expect(launchPresentationDetails(launch, 4663, market).pair).toEqual({ address: address("3"), label: "QUOTE" });
    expect(launchPresentationDetails(launch, 4663, { ...market, poolId: hash("4") }).pair).toBeNull();
    expect(launchPresentationDetails(launch, 4663, { ...market, quoteAsset: { address: launch.tokenAddress, symbol: "SELF" } }).pair).toBeNull();
    expect(launchPresentationDetails({ ...launch, sourceKind: "module-foundation-v1", quoteAsset: weth }, 4663, market).pair?.label).toBe("WETH");
    expect(launchPresentationDetails(launch, 4663, { ...market, quoteAsset: { address: address("3"), symbol: "spoof\u202e" } }).pair?.label).toBe("0x3333…3333");
  });

  it("uses only exact selected module revisions and otherwise shows a truthful count", () => {
    const selected = { ...launch, sourceKind: "module-native-v2" as const, sourceReleaseDigest: hash("4"), modulePackageIds: [hash("5")], moduleFamilyIds: [hash("6")] };
    const details: PublicModuleDetails = { releaseDigest: hash("4"), items: [{ packageId: hash("5"), familyId: hash("6"),
      title: "Buy cap", description: "A launch limit.", version: "1", author: address("7"), category: "trading", manifestHash: hash("8") }] };
    expect(launchPresentationDetails(selected, 4663, null, details)).toMatchObject({ modules: ["Buy cap"], moduleCount: 1 });
    for (const wrong of [{ ...details, releaseDigest: hash("9") }, { ...details, items: [{ ...details.items[0], familyId: hash("9") }] }]) {
      expect(launchPresentationDetails(selected, 4663, null, wrong)).toMatchObject({ modules: [], moduleCount: 1 });
    }
    const html = renderToStaticMarkup(<LaunchPairModules launch={selected} chainId={4663} />);
    expect(html).toContain("<dt>Modules</dt><dd>1</dd>");
    expect(html).not.toContain("No modules");
    expect(renderToStaticMarkup(<LaunchPairModules launch={launch} chainId={4663} />)).toBe("");
  });
});
