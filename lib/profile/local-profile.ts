import { getTokenImageFileError, MAX_TOKEN_IMAGE_SOURCE_BYTES } from "../token-image";

export const PROFILE_STORAGE_PREFIX = "programmable-profile";
export const PROFILE_UPDATED_EVENT = "programmable:profile-updated";
export const MAXIMUM_AVATAR_FILE_BYTES = MAX_TOKEN_IMAGE_SOURCE_BYTES;
export const MAXIMUM_AVATAR_DATA_URL_CHARACTERS = 1_500_000;
export const MAXIMUM_AVATAR_DIMENSION = 12_000;
export const MAXIMUM_AVATAR_PIXELS = 60_000_000;

export const ACCEPTED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const ethereumAddressPattern = /^0x[a-f0-9]{40}$/;
const usernamePattern = /^[A-Za-z0-9]{3,12}$/;
const safeAvatarDataUrlPattern =
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export type LocalProfile = {
  username: string;
  avatarDataUrl: string;
  bannerDataUrl?: string;
  bannerPositionX?: number;
  bannerPositionY?: number;
  bio?: string;
  xUrl?: string;
  websiteUrl?: string;
  githubUrl?: string;
};

type ProfileStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type AvatarFileMetadata = {
  name?: string;
  size: number;
  type: string;
};

type StoredProfile = {
  version: 1 | 2;
  username: string;
  avatarDataUrl: string;
  bannerDataUrl?: string;
  bannerPositionX?: number;
  bannerPositionY?: number;
  bio?: string;
  xUrl?: string;
  websiteUrl?: string;
  githubUrl?: string;
};

export const EMPTY_LOCAL_PROFILE: Readonly<LocalProfile> = Object.freeze({
  username: "",
  avatarDataUrl: "",
});

export function getProfileStorageKey(address: string) {
  const normalizedAddress = address.trim().toLowerCase();

  if (!ethereumAddressPattern.test(normalizedAddress)) {
    throw new Error("A valid wallet address is required");
  }

  return `${PROFILE_STORAGE_PREFIX}:${normalizedAddress}`;
}

export function profileDraftBelongsToAccount(editingAccount: string, account: string) {
  const normalizedAccount = account.trim().toLowerCase();
  return ethereumAddressPattern.test(normalizedAccount)
    && editingAccount.toLowerCase() === normalizedAccount;
}

export function normalizeProfileUsername(username: string) {
  return username.trim();
}

export function getProfileUsernameError(username: string) {
  const normalizedUsername = normalizeProfileUsername(username);

  if (!normalizedUsername || usernamePattern.test(normalizedUsername)) {
    return "";
  }

  return "Use 3–12 letters or numbers";
}

export function getAvatarFileError(file: AvatarFileMetadata) {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "Choose a non-empty image";
  return getTokenImageFileError(file);
}

export function getAvatarDimensionsError(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "The image has invalid dimensions";
  }

  if (
    width > MAXIMUM_AVATAR_DIMENSION ||
    height > MAXIMUM_AVATAR_DIMENSION ||
    width * height > MAXIMUM_AVATAR_PIXELS
  ) {
    return "Choose an image under 60 megapixels";
  }

  return "";
}

export function isSafeAvatarDataUrl(value: string) {
  if (!value) return true;

  return (
    value.length <= MAXIMUM_AVATAR_DATA_URL_CHARACTERS &&
    safeAvatarDataUrlPattern.test(value)
  );
}

export function parseLocalProfile(value: string | null): LocalProfile {
  if (!value) return { ...EMPTY_LOCAL_PROFILE };

  try {
    const stored = JSON.parse(value) as Partial<StoredProfile>;
    if (stored.version !== 1 && stored.version !== 2) {
      return { ...EMPTY_LOCAL_PROFILE };
    }

    const username =
      typeof stored.username === "string"
        ? normalizeProfileUsername(stored.username)
        : "";
    const avatarDataUrl =
      typeof stored.avatarDataUrl === "string" &&
      isSafeAvatarDataUrl(stored.avatarDataUrl)
        ? stored.avatarDataUrl
        : "";

    const baseProfile: LocalProfile = {
      username: getProfileUsernameError(username) ? "" : username,
      avatarDataUrl,
    };
    if (stored.version === 1) return baseProfile;

    const bannerDataUrl =
      typeof stored.bannerDataUrl === "string" &&
      isSafeAvatarDataUrl(stored.bannerDataUrl)
        ? stored.bannerDataUrl
        : "";
    const position = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, Math.min(100, value))
        : 50;
    const text = (value: unknown, maximum: number) =>
      typeof value === "string" ? value.trim().slice(0, maximum) : "";

    return {
      ...baseProfile,
      bannerDataUrl,
      bannerPositionX: position(stored.bannerPositionX),
      bannerPositionY: position(stored.bannerPositionY),
      bio: text(stored.bio, 240),
      xUrl: text(stored.xUrl, 200),
      websiteUrl: text(stored.websiteUrl, 200),
      githubUrl: text(stored.githubUrl, 200),
    };
  } catch {
    return { ...EMPTY_LOCAL_PROFILE };
  }
}

export function readLocalProfile(
  storage: ProfileStorage,
  address: string,
): LocalProfile {
  return parseLocalProfile(storage.getItem(getProfileStorageKey(address)));
}

export function writeLocalProfile(
  storage: ProfileStorage,
  address: string,
  profile: LocalProfile,
) {
  const username = normalizeProfileUsername(profile.username);
  const usernameError = getProfileUsernameError(username);

  if (usernameError) {
    throw new Error(usernameError);
  }

  if (!isSafeAvatarDataUrl(profile.avatarDataUrl)) {
    throw new Error("The prepared image is not safe to store");
  }

  if (!isSafeAvatarDataUrl(profile.bannerDataUrl ?? "")) {
    throw new Error("The prepared banner is not safe to store");
  }

  const key = getProfileStorageKey(address);

  const hasExtendedProfile = Boolean(
    profile.bannerDataUrl ||
      profile.bio ||
      profile.xUrl ||
      profile.websiteUrl ||
      profile.githubUrl,
  );

  if (!username && !profile.avatarDataUrl && !hasExtendedProfile) {
    storage.removeItem(key);
    return;
  }

  const storedProfile: StoredProfile = {
    version: hasExtendedProfile ? 2 : 1,
    username,
    avatarDataUrl: profile.avatarDataUrl,
    ...(hasExtendedProfile
      ? {
          bannerDataUrl: profile.bannerDataUrl ?? "",
          bannerPositionX: Math.max(
            0,
            Math.min(100, profile.bannerPositionX ?? 50),
          ),
          bannerPositionY: Math.max(
            0,
            Math.min(100, profile.bannerPositionY ?? 50),
          ),
          bio: (profile.bio ?? "").trim().slice(0, 240),
          xUrl: (profile.xUrl ?? "").trim().slice(0, 200),
          websiteUrl: (profile.websiteUrl ?? "").trim().slice(0, 200),
          githubUrl: (profile.githubUrl ?? "").trim().slice(0, 200),
        }
      : {}),
  };

  storage.setItem(key, JSON.stringify(storedProfile));
}
