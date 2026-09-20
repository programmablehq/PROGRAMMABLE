import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  profileEntryHasPublicAccount,
  shouldLoadProfileEntryView,
} from "../components/profile-entry";

const profilePageSource = readFileSync(
  new URL("../app/profile/page.tsx", import.meta.url),
  "utf8",
);
const profileEntrySource = readFileSync(
  new URL("../components/profile-entry.tsx", import.meta.url),
  "utf8",
);

describe("profile entry", () => {
  it("loads the full profile only for a connected or public profile", () => {
    expect(shouldLoadProfileEntryView({
      publicProfileRequested: false,
    })).toBe(false);
    expect(shouldLoadProfileEntryView({
      account: "0x1111111111111111111111111111111111111111",
      publicProfileRequested: false,
    })).toBe(true);
    expect(shouldLoadProfileEntryView({
      publicProfileRequested: true,
    })).toBe(true);
  });

  it("recognizes only one valid public account query", () => {
    expect(profileEntryHasPublicAccount([
      "0x1111111111111111111111111111111111111111",
    ])).toBe(true);
    expect(profileEntryHasPublicAccount([
      "  0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA  ",
    ])).toBe(true);
    expect(profileEntryHasPublicAccount([])).toBe(false);
    expect(profileEntryHasPublicAccount(["not-an-address"])).toBe(false);
    expect(profileEntryHasPublicAccount([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ])).toBe(false);
  });

  it("keeps the heavy profile view behind a conditional dynamic import", () => {
    expect(profilePageSource).toContain(
      'from "@/components/profile-entry"',
    );
    expect(profilePageSource).not.toContain(
      'from "@/components/profile-view"',
    );
    expect(profileEntrySource).toContain('import dynamic from "next/dynamic"');
    expect(profileEntrySource).toContain(
      'import("@/components/profile-view")',
    );
    expect(profileEntrySource).toContain("dynamic(loadProfileView");
    expect(profileEntrySource).not.toMatch(/ssr:\s*false/u);
    expect(profileEntrySource).toContain("useSearchParams");
    expect(profileEntrySource).not.toMatch(
      /from\s+["']@\/components\/profile-view["']/u,
    );
    expect(profileEntrySource).toMatch(
      /if \(shouldLoadProfileEntryView\([\s\S]*?return <ProfileView viewChainId=\{4663\} \/>;/u,
    );
    expect(profileEntrySource).toContain(
      "loadProfileView().catch(() => undefined)",
    );
    expect(profileEntrySource).toContain("onPointerEnter={onPrepareProfile}");
  });

  it("uses the same identity-free skeleton during passive session restoration", () => {
    expect(profileEntrySource).toContain('from "@/components/profile-skeleton"');
    expect(profileEntrySource).toMatch(/if \(connecting\) return openingWallet[\s\S]*?<ProfileEntryFrame loading[\s\S]*?: <ProfileEntryLoadingState \/>/u);
    expect(profileEntrySource).toContain('<ProfileLoadingSkeleton label="Loading profile" showHero />');
  });
});
