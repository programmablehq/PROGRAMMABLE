import { describe, expect, it } from "vitest";

import {
  getAvatarDimensionsError,
  getAvatarFileError,
  getProfileStorageKey,
  getProfileUsernameError,
  isSafeAvatarDataUrl,
  parseLocalProfile,
  profileDraftBelongsToAccount,
  PROFILE_UPDATED_EVENT,
  writeLocalProfile,
} from "../lib/profile/local-profile";
import { isProfileDataForAccount } from "../lib/profile/onchain-profile";

const wallet = "0xAAbbccDDeeFF0011223344556677889900AAbbCC";

function createStorage() {
  const values = new Map<string, string>();

  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("wallet-scoped local profile", () => {
  it("uses the exact lowercase wallet storage key and update event", () => {
    expect(getProfileStorageKey(wallet)).toBe(
      "programmable-profile:0xaabbccddeeff0011223344556677889900aabbcc",
    );
    expect(PROFILE_UPDATED_EVENT).toBe("programmable:profile-updated");
    expect(() => getProfileStorageKey("not-an-address")).toThrow(
      "valid wallet address",
    );
  });

  it("only saves a draft for the wallet that opened the profile editor", () => {
    expect(profileDraftBelongsToAccount(wallet.toLowerCase(), wallet)).toBe(true);
    expect(profileDraftBelongsToAccount(wallet, wallet.toLowerCase())).toBe(true);
    expect(profileDraftBelongsToAccount(wallet, `0x${"b".repeat(40)}`)).toBe(false);
    expect(profileDraftBelongsToAccount("", wallet)).toBe(false);
    expect(profileDraftBelongsToAccount("invalid", "invalid")).toBe(false);
  });

  it("accepts only optional 3 to 12 character ASCII alphanumeric usernames", () => {
    expect(getProfileUsernameError("")).toBe("");
    expect(getProfileUsernameError("  Bloom36  ")).toBe("");
    expect(getProfileUsernameError("ab")).toBe(
      "Use 3–12 letters or numbers",
    );
    expect(getProfileUsernameError("thirteenChars1")).toBe(
      "Use 3–12 letters or numbers",
    );
    expect(getProfileUsernameError("name_one")).toBe(
      "Use 3–12 letters or numbers",
    );
    expect(getProfileUsernameError("Kémal")).toBe(
      "Use 3–12 letters or numbers",
    );
  });

  it("rejects unsafe avatar types, empty files and oversized files", () => {
    expect(getAvatarFileError({ type: "image/jpeg", size: 1 })).toBe("");
    expect(getAvatarFileError({ type: "image/svg+xml", size: 1 })).toBe(
      "Choose a JPG, PNG, WebP or HEIC image",
    );
    expect(getAvatarFileError({ type: "image/png", size: 0 })).toBe(
      "Choose a non-empty image",
    );
    expect(
      getAvatarFileError({
        type: "image/webp",
        size: 20_000_001,
      }),
    ).toBe("Choose an image smaller than 20 MB");
  });

  it("rejects invalid or excessive decoded image dimensions", () => {
    expect(getAvatarDimensionsError(512, 512)).toBe("");
    expect(getAvatarDimensionsError(0, 512)).toBe(
      "The image has invalid dimensions",
    );
    expect(getAvatarDimensionsError(10_000, 5_000)).toBe(
      "Choose an image under 48 megapixels",
    );
  });

  it("sanitizes malformed or tampered stored profile data", () => {
    expect(parseLocalProfile("{not-json")).toEqual({
      username: "",
      avatarDataUrl: "",
    });
    expect(
      parseLocalProfile(
        JSON.stringify({
          version: 1,
          username: "bad_name",
          avatarDataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
        }),
      ),
    ).toEqual({
      username: "",
      avatarDataUrl: "",
    });
    expect(isSafeAvatarDataUrl("data:image/webp;base64,AAAA")).toBe(true);
    expect(isSafeAvatarDataUrl("javascript:alert(1)")).toBe(false);
  });

  it("writes one wallet-scoped record and removes an empty profile", () => {
    const storage = createStorage();
    const key = getProfileStorageKey(wallet);

    writeLocalProfile(storage, wallet, {
          username: "  Bloom36  ",
      avatarDataUrl: "data:image/webp;base64,AAAA",
    });

    expect(JSON.parse(storage.values.get(key) ?? "")).toEqual({
      version: 1,
      username: "Bloom36",
      avatarDataUrl: "data:image/webp;base64,AAAA",
    });

    writeLocalProfile(storage, wallet, {
      username: "",
      avatarDataUrl: "",
    });
    expect(storage.values.has(key)).toBe(false);
  });

  it("never treats profile API data for another wallet as current", () => {
    const data = {
      account: "0x0000000000000000000000000000000000000001" as const,
      status: "ready" as const,
      tokens: [],
      positions: [],
      claims: [],
      activity: [],
    };

    expect(
      isProfileDataForAccount(
        data,
        "0x0000000000000000000000000000000000000001",
      ),
    ).toBe(true);
    expect(
      isProfileDataForAccount(
        data,
        "0x0000000000000000000000000000000000000002",
      ),
    ).toBe(false);
    expect(
      isProfileDataForAccount(
        { ...data, account: undefined },
        "0x0000000000000000000000000000000000000001",
      ),
    ).toBe(false);
  });
});
