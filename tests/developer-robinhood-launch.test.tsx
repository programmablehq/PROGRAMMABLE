import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DeveloperApiKeysView } from "../components/developer-api-keys";
import { RobinhoodFeePolicyDisclosure } from "../components/robinhood-fee-policy-disclosure";
import { developerApiKeysInitialSection } from "../lib/developer-api-key-route";

const apiKeysSource = readFileSync(
  new URL("../components/developer-api-keys.tsx", import.meta.url), "utf8",
);
const launchEntrySource = readFileSync(
  new URL("../components/launch-entry.tsx", import.meta.url), "utf8",
);

describe("Robinhood API launch website handoff", () => {
  it("shows prepared launches without manual upload or API request controls", () => {
    const getToken = vi.fn(async () => null);
    const walletAction = vi.fn(async (): Promise<`0x${string}`> => {
      throw new Error("Opening a launch must not perform wallet actions");
    });
    for (const account of [null, "0x0000000000000000000000000000000000000001"] as const) {
      const html = renderToStaticMarkup(createElement(DeveloperApiKeysView, {
        account, authReady: true, connecting: false, initialSection: "history",
        getAccessToken: getToken, getIdentityToken: getToken, openWallet: vi.fn(),
        sendCustomLaunchWalletAction: walletAction,
        sendCustomLaunchWalletActionV4: walletAction,
        signCustomLaunchFundingAuthorization: walletAction,
      }));
      expect(html).toContain("Your launches");
      expect(html).toContain("Review and sign launches prepared through the API.");
      expect(html).toContain("Launches");
      expect(html).toContain("API keys");
      expect(html).not.toContain('type="file"');
      expect(html).not.toContain('type="password"');
      expect(html).not.toContain("Run preflight");
      expect(html).not.toContain("Create launch request");
      expect(html).not.toContain("Idempotency-Key");
    }
    expect(getToken).not.toHaveBeenCalled();
    expect(walletAction).not.toHaveBeenCalled();
  });

  it("renders one static, labelled fee policy disclosure for API launch review", () => {
    const html = renderToStaticMarkup(<RobinhoodFeePolicyDisclosure />);

    expect(html).toContain(
      'aria-labelledby="robinhood-fee-policy-title"',
    );
    expect(html).toContain(
      '<span id="robinhood-fee-policy-title">Robinhood fee policy</span><span>0.20%</span>',
    );
    expect(html).toContain(
      "Programmable policy for new Robinhood V4 API Custom launch requests is 0.20% (2,000 ppm), recipient <code>0xD88539d3c4C460136a733A3Fd60cf6BF269079da</code>. Existing launches are unchanged.",
    );
    expect(html).toContain(
      "The current V4 runtime does not claim immutable onchain fee enforcement, fee behavior, claiming, or guaranteed revenue. The Launch Stamp proves provenance only.",
    );
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain("fee-policy-pending");
  });


  it("keeps old Custom links and wallet handoffs on the prepared launch view", () => {
    expect(launchEntrySource).toContain(
      'href="/developers/api-keys?start=custom&chainId=4663"',
    );
    expect(launchEntrySource).toContain('data-launch-model-entry="developer-launch"');
    expect(apiKeysSource).not.toContain("DeveloperRobinhoodLaunch");
    expect(apiKeysSource).toContain('searchParams.get("launchId")');
    expect(apiKeysSource).toContain('searchParams.get("start") === "custom"');
    expect(apiKeysSource).toContain("<DeveloperUniversalLaunchHistory");
    expect(apiKeysSource).toContain("<DeveloperLaunchHistory");
    expect(apiKeysSource.match(/<RobinhoodFeePolicyDisclosure \/>/gu)).toHaveLength(1);
    expect(developerApiKeysInitialSection({ start: "custom", chainId: "4663" })).toBe("history");
    expect(developerApiKeysInitialSection({ start: "custom", chainId: "1" })).toBe("history");
    expect(developerApiKeysInitialSection({ view: "history", launchId: "saved-launch" })).toBe("history");
    expect(developerApiKeysInitialSection({ chainId: "4663" })).toBe("keys");
  });
});
