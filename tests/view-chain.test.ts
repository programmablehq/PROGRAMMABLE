import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW_CHAIN_ID,
  VIEW_CHAIN_COOKIE_NAME,
  VIEW_CHAIN_STORAGE_KEY,
  isViewChainId,
  parseViewChainId,
  serializeViewChainCookie,
  tryParseViewChainId,
} from "../lib/view-chain";
import {
  isRobinhoodExploreAvailableResponse,
  resolveExploreChainId,
} from "../lib/explore-chain";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("view chain", () => {
  it("preserves historical chain parsing but pins public preferences to Robinhood", () => {
    expect(DEFAULT_VIEW_CHAIN_ID).toBe(4663);
    expect(isViewChainId(1)).toBe(true);
    expect(isViewChainId(4663)).toBe(true);
    expect(isViewChainId("4663")).toBe(false);
    expect(tryParseViewChainId("1")).toBe(1);
    expect(tryParseViewChainId("4663")).toBe(4663);
    expect(tryParseViewChainId("8453")).toBeNull();
    expect(tryParseViewChainId("11155111")).toBeNull();
    expect(parseViewChainId("1")).toBe(4663);
    expect(parseViewChainId(1)).toBe(4663);
    expect(parseViewChainId("4663")).toBe(4663);
    expect(parseViewChainId(null)).toBe(4663);
    expect(parseViewChainId("invalid")).toBe(4663);
  });

  it("serializes a long-lived, site-wide preference cookie", () => {
    expect(VIEW_CHAIN_COOKIE_NAME).toBe("programmable-view-chain-v2");
    expect(VIEW_CHAIN_STORAGE_KEY).toBe("programmable:view-chain:v2");
    expect(serializeViewChainCookie(4663)).toContain(
      "programmable-view-chain-v2=4663",
    );
    expect(serializeViewChainCookie(4663)).toContain("Path=/");
    expect(serializeViewChainCookie(4663)).toContain("SameSite=Lax");
  });

  it("accepts supported Explore preferences and normalizes invalid chains", () => {
    expect(resolveExploreChainId(1)).toBe(1);
    expect(resolveExploreChainId(4663)).toBe(4663);
    expect(resolveExploreChainId(8453)).toBe(4663);
    expect(resolveExploreChainId("invalid")).toBe(4663);
  });

  it("derives Robinhood availability only from a non-empty ready server response", () => {
    const ready = {
      status: "ready",
      chainId: 4663,
      total: 1,
      catalog: {
        source: "robinhood-finalized-custom-launch-feed-v4",
        completeness: { custom: "current" },
      },
    };
    expect(isRobinhoodExploreAvailableResponse(ready)).toBe(true);
    expect(isRobinhoodExploreAvailableResponse({ ...ready, total: 0 })).toBe(
      false,
    );
    expect(
      isRobinhoodExploreAvailableResponse({
        ...ready,
        status: "not-deployed",
      }),
    ).toBe(false);
    expect(
      isRobinhoodExploreAvailableResponse({
        ...ready,
        catalog: { ...ready.catalog, completeness: { custom: "unavailable" } },
      }),
    ).toBe(false);
  });

  it("resolves the server cookie only inside chain-bound product routes", () => {
    const provider = read("components/view-chain.tsx");
    const shell = read("components/app-shell.tsx");
    const layout = read("app/layout.tsx");
    const resolvedLayout = read("components/resolved-view-chain-layout.tsx");
    const routeBoundary = read("components/view-chain-route-boundary.tsx");

    expect(provider).toContain("window.localStorage.getItem");
    expect(provider).toContain(
      "readStoredViewChain() ?? readViewChainCookie()",
    );
    expect(provider).toContain("readBrowserViewChain() ?? parseViewChainId(initialViewChainId)");
    expect(provider).toContain('window.addEventListener("storage"');
    expect(provider).toContain("document.cookie = serializeViewChainCookie");
    expect(provider).not.toContain("useWallet");
    expect(provider).not.toContain("switchNetwork");
    expect(provider).not.toContain("disconnect");
    expect(shell.indexOf("<ViewChainProvider")).toBeLessThan(
      shell.indexOf("<WalletProvider>"),
    );
    expect(provider).toContain(
      "const resolvedViewChainId = useSyncExternalStore(",
    );
    expect(provider).toContain(
      "const getServerSnapshot = useCallback((): ViewChainId | null => null",
    );
    expect(provider).toContain("const hydrated = resolvedViewChainId !== null");
    expect(provider).toContain("const currentViewChainId = getViewChainSnapshot()");
    expect(provider).toContain("persistViewChain(currentViewChainId)");
    expect(layout).not.toContain('from "next/headers"');
    expect(layout).not.toContain("cookies()");
    expect(resolvedLayout).toContain('import { cookies } from "next/headers"');
    expect(resolvedLayout).toContain("const requestCookies = await cookies()");
    expect(resolvedLayout).toContain(
      "requestCookies.get(VIEW_CHAIN_COOKIE_NAME)?.value",
    );
    expect(routeBoundary).toContain(
      "const resolvedViewChainId = hydrated ? viewChainId : initialViewChainId",
    );
    expect(routeBoundary).toContain("initialViewChainId === null");
    expect(routeBoundary).toContain("<ViewChainPending />");
    expect(routeBoundary).toContain("resolvedViewChainId === 4663");
    expect(read("app/profile/layout.tsx"))
      .not.toContain("ResolvedViewChainLayout");
    expect(existsSync("app/launch/layout.tsx")).toBe(false);
    expect(read("app/launch/page.tsx"))
      .toContain("requestCookies.get(VIEW_CHAIN_COOKIE_NAME)?.value");
    expect(existsSync("app/token/layout.tsx")).toBe(false);
  });

  it("does not mount network selectors in public product views", () => {
    for (const path of [
      "components/site-navigation.tsx", "components/profile-entry.tsx", "components/profile-view.tsx",
      "components/launch-entry.tsx", "components/explore-view.tsx",
      "components/explore-index-reset-view.tsx", "components/robinhood-launches-view.tsx",
    ]) {
      const source = read(path);
      expect(source).not.toContain("<ProfileChainSelector");
      expect(source).not.toContain("<ExploreChainSelector");
      expect(source).not.toContain("<HeaderChainToggle");
    }
    expect(read("components/profile-view.tsx")).not.toContain("<ProfileModules");
  });
});
