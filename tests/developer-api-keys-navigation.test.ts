import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import CustomHookBuilderPage from "../app/developers/hooks/page";

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
