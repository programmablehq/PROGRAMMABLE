import { hexToString, stringToHex, type Hex } from "viem";
import { MAX_SOCIAL_EXTRA_DATA_BYTES, utf8ByteLength } from "@/lib/metadata-policy";
import { parseFoundationAssetPinsV1, type FoundationAssetPinV1 } from "./assets";

function packageIds(value: unknown): readonly Hex[] {
  if (!Array.isArray(value) || value.length > 8 || value.some(id => typeof id !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(id) || BigInt(id) === 0n)) {
    throw new Error("The exact source package identities could not be bound to the coin metadata.");
  }
  const ids = value.map(id => (id as string).toLowerCase() as Hex);
  if (new Set(ids).size !== ids.length) throw new Error("A source package cannot appear twice in the coin metadata.");
  return Object.freeze(ids);
}

/** Immutable, ordered source identities disambiguate versions which intentionally compile to the same code. */
export function withFoundationModulePackages(socialData: Hex, ids: readonly Hex[], assetPins: readonly FoundationAssetPinV1[] = []): Hex {
  const social = socialData === "0x" ? { v: 1 } : JSON.parse(hexToString(socialData)) as Record<string, unknown>;
  if (!social || Array.isArray(social) || social.v !== 1 || Object.hasOwn(social, "foundation")) throw new Error("The social metadata envelope is unsupported.");
  const assets = parseFoundationAssetPinsV1(assetPins);
  const encoded = JSON.stringify({ ...social, foundation: { v: 1, packages: packageIds(ids), ...(assets.length ? { assets } : {}) } });
  if (utf8ByteLength(encoded) > MAX_SOCIAL_EXTRA_DATA_BYTES) throw new Error("The social links, source identities and asset bindings exceed 1,200 bytes. Use shorter social links.");
  return stringToHex(encoded);
}

/** This restores identifiers only. Catalog admission, exact calldata and runtime checks still establish authority. */
function sourceEnvelope(socialData: Hex): Record<string, unknown> | undefined {
  if (socialData === "0x") return undefined;
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(socialData) || (socialData.length - 2) / 2 > MAX_SOCIAL_EXTRA_DATA_BYTES) throw new Error("The coin's source metadata exceeds its supported size.");
  let decoded: unknown;
  try { decoded = JSON.parse(hexToString(socialData)); } catch { return undefined; }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || !Object.hasOwn(decoded, "foundation")) return undefined;
  const envelope = decoded as Record<string, unknown>, foundation = envelope.foundation;
  if (envelope.v !== 1 || !foundation || typeof foundation !== "object" || Array.isArray(foundation)
    || (foundation as Record<string, unknown>).v !== 1) throw new Error("The coin's source metadata version is unsupported.");
  const source = foundation as Record<string, unknown>;
  if (Object.keys(source).some(key => !["v", "packages", "assets"].includes(key))) throw new Error("The coin's source metadata fields are unsupported.");
  packageIds(source.packages);
  parseFoundationAssetPinsV1(source.assets ?? []);
  return source;
}

/** This restores identifiers only. Catalog admission, exact calldata and runtime checks still establish authority. */
export function readFoundationModulePackages(socialData: Hex, moduleCount?: number): readonly Hex[] | undefined {
  const source = sourceEnvelope(socialData);
  if (!source) return undefined;
  const ids = packageIds(source.packages);
  if (moduleCount !== undefined && ids.length !== moduleCount) throw new Error("The source identities do not match the installed module count.");
  return ids;
}

/** Address, precision and code identities come from the immutable token envelope and still require fresh RPC checks. */
export function readFoundationAssetPins(socialData: Hex): readonly FoundationAssetPinV1[] {
  return parseFoundationAssetPinsV1(sourceEnvelope(socialData)?.assets ?? []);
}
