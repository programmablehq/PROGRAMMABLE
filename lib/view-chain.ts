export type ViewChainId = 1 | 4663;

export const DEFAULT_VIEW_CHAIN_ID: ViewChainId = 4663;
// Earlier releases saved Ethereum automatically. Start the Robinhood default
// once under a new preference version, then keep subsequent explicit choices.
export const VIEW_CHAIN_COOKIE_NAME = "programmable-view-chain-v2";
export const VIEW_CHAIN_STORAGE_KEY = "programmable:view-chain:v2";
export const VIEW_CHAIN_CHANGE_EVENT = "programmable:view-chain-change";
export const VIEW_CHAIN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const VIEW_CHAIN_OPTIONS = [
  { id: 1, label: "Ethereum" },
  { id: 4663, label: "Robinhood" },
] as const satisfies ReadonlyArray<{
  id: ViewChainId;
  label: string;
}>;

export function tryParseViewChainId(value: unknown): ViewChainId | null {
  if (value === 1 || value === "1") return 1;
  if (value === 4663 || value === "4663") return 4663;
  return null;
}

export function isViewChainId(value: unknown): value is ViewChainId {
  return value === 1 || value === 4663;
}

export function parseViewChainId(value: unknown): ViewChainId {
  // Public product views currently support Robinhood only, including old saved preferences.
  const chainId = tryParseViewChainId(value);
  return chainId === 4663 ? chainId : DEFAULT_VIEW_CHAIN_ID;
}

export function serializeViewChainCookie(viewChainId: ViewChainId): string {
  return `${VIEW_CHAIN_COOKIE_NAME}=${viewChainId}; Path=/; Max-Age=${VIEW_CHAIN_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
