import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import CustomHookBuilderPage from "../app/developers/hooks/page";
import { developerApiKeysInitialSection, developerLaunchDestination } from "../lib/developer-api-key-route";
import { generalSubmissionUrl, type GeneralPreparationView } from "../lib/custom-ai/general-preparation";

describe("the canonical custom-hook key page", () => {
  beforeEach(() => redirect.mockReset());

  it("opens the in-page guide from the former hook builder route", async () => {
    await CustomHookBuilderPage({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith("/developers/api-keys?guide=custom-hook");
  });

  it.each([
    [{ view: "history", launchId: "saved-launch", chainId: "1" },
      "/developers/api-keys?view=history&launchId=saved-launch&chainId=1"],
    [{ start: "custom", chainId: "4663" },
      "/developers/api-keys?start=custom&chainId=4663"],
    [{ launchId: "saved-launch", chainId: "4663" },
      "/developers/api-keys?launchId=saved-launch&chainId=4663"],
  ] as const)("preserves launch and recovery parameters %j", async (params, destination) => {
    await CustomHookBuilderPage({ searchParams: Promise.resolve(params) });
    expect(redirect).toHaveBeenCalledWith(destination);
  });

  it("encodes repeated query values while keeping the redirect local", async () => {
    await CustomHookBuilderPage({ searchParams: Promise.resolve({
      tag: ["a&view=history", "b"],
      next: "https://elsewhere.example/",
      guide: "custom-hook",
      missing: undefined,
    }) });
    const destination = redirect.mock.calls[0][0] as string;
    const url = new URL(destination, "https://programmable.market");
    expect(url.origin).toBe("https://programmable.market");
    expect(url.pathname).toBe("/developers/api-keys");
    expect(url.searchParams.getAll("tag")).toEqual(["a&view=history", "b"]);
    expect(url.searchParams.has("view")).toBe(false);
    expect(url.searchParams.get("next")).toBe("https://elsewhere.example/");
    expect(url.searchParams.getAll("guide")).toEqual(["custom-hook"]);
    expect(url.searchParams.has("missing")).toBe(false);
  });
});

describe("opening exact Custom AI launch handoffs", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  it.each([1, 4663, 8453, 999] as const)("opens chain %s directly in the correct launch history", chainId => {
    const preparation = { chainId, submission: { state: "completed", resourceId: id } } as GeneralPreparationView;
    const href = generalSubmissionUrl(preparation)!;
    const query = new URL(href, "https://programmable.market").searchParams;
    expect(developerLaunchDestination(query)).toEqual({ launchId: id, chainId: chainId === 1 ? null : String(chainId) });
    expect(developerApiKeysInitialSection(Object.fromEntries(query))).toBe("history");
  });
  it("preserves explicit Ethereum links and ordinary key/history defaults", () => {
    expect(developerLaunchDestination(new URLSearchParams({ launchId: id, chainId: "1" }))).toEqual({ launchId: id, chainId: null });
    expect(developerLaunchDestination(new URLSearchParams())).toEqual({ launchId: null, chainId: "4663" });
    expect(developerApiKeysInitialSection({})).toBe("keys");
    expect(developerApiKeysInitialSection({ view: "history" })).toBe("history");
  });
  it("does not guess a launch from invalid, duplicate or unsupported handoff parameters", () => {
    for (const query of [new URLSearchParams({ launchId: "invalid" }), new URLSearchParams({ launchId: id, chainId: "56" }),
      new URLSearchParams(`launchId=${id}&launchId=${id}&chainId=1`), new URLSearchParams(`launchId=${id}&chainId=1&chainId=4663`)])
      expect(developerLaunchDestination(query).launchId).toBeNull();
  });
});
