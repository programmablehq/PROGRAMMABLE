import { rpcProviderCommitment } from
  "../data-pipeline/rpc-provider-commitments";

import type { MainnetRpcProviderId } from "./types";

const RPC_ENDPOINT_COMMITMENT = /^0x[0-9a-f]{64}$/u;
const ALCHEMY_MAINNET_RPC_HOST = "eth-mainnet.g.alchemy.com";
const ALCHEMY_MAINNET_RPC_PATH = /^\/v2\/[A-Za-z0-9_-]{8,256}$/u;
const DRPC_MAINNET_RPC_HOST = "lb.drpc.live";
const DRPC_MAINNET_RPC_PATH = /^\/ethereum\/[A-Za-z0-9_-]{8,512}\/?$/u;
const QUICKNODE_MAINNET_RPC_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ethereum-mainnet\.quiknode\.pro$/u;
const QUICKNODE_MAINNET_RPC_PATH = /^\/[A-Za-z0-9_-]{8,256}\/?$/u;
const TENDERLY_RECOVERY_MAINNET_RPC_URL =
  "https://mainnet.gateway.tenderly.co/";
const TENDERLY_RECOVERY_MAINNET_RPC_ENDPOINT_COMMITMENT =
  "0x64d51011a3cc5cd1147970d28c3b771000e1ae0b89f4711d4898386f10fc167f";

export const WEBSITE_MAINNET_RPC_ENV = Object.freeze({
  primaryProvider: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER",
  primaryUrl: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL",
  primaryCommitment:
    "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
  secondaryProvider: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER",
  secondaryUrl: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL",
  secondaryCommitment:
    "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
} as const);

export type WebsiteRpcBinding = Readonly<{
  provider: MainnetRpcProviderId;
  url: string;
  endpointCommitment: string;
}>;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type WebsiteMainnetRpcPair = Readonly<{
  source: "role-bound-v1" | "legacy-alchemy-quicknode";
  primary: WebsiteRpcBinding;
  secondary: WebsiteRpcBinding;
}>;

export type ProductionRecoveryMainnetRpcPair = Readonly<{
  source: "fixed-tenderly-quicknode-v1";
  primary: Readonly<{
    provider: "tenderly";
    url: string;
    endpointCommitment: string;
  }>;
  secondary: WebsiteRpcBinding & Readonly<{ provider: "quicknode" }>;
}>;

export function productionMainnetRpcEnvironment(
  primaryUrl: string,
  secondaryUrl: string,
) {
  return Object.freeze({
    [WEBSITE_MAINNET_RPC_ENV.primaryProvider]: "drpc",
    [WEBSITE_MAINNET_RPC_ENV.primaryUrl]: primaryUrl,
    [WEBSITE_MAINNET_RPC_ENV.primaryCommitment]:
      rpcProviderCommitment("endpoint", primaryUrl),
    [WEBSITE_MAINNET_RPC_ENV.secondaryProvider]: "quicknode",
    [WEBSITE_MAINNET_RPC_ENV.secondaryUrl]: secondaryUrl,
    [WEBSITE_MAINNET_RPC_ENV.secondaryCommitment]:
      rpcProviderCommitment("endpoint", secondaryUrl),
  });
}

function selectedLegacyValue(
  preferred: string | undefined,
  legacy: string | undefined,
) {
  return preferred === undefined || preferred === ""
    ? legacy
    : preferred;
}

function providerId(
  value: string | undefined,
  role: "primary" | "secondary",
): MainnetRpcProviderId {
  if (value === "alchemy" || value === "drpc" || value === "quicknode") {
    return value;
  }
  throw new Error(`Website ${role} RPC provider binding is invalid`);
}

function providerPathIsValid(parsed: URL, provider: MainnetRpcProviderId) {
  if (provider === "alchemy") {
    return parsed.hostname === ALCHEMY_MAINNET_RPC_HOST &&
      ALCHEMY_MAINNET_RPC_PATH.test(parsed.pathname) &&
      parsed.pathname.slice("/v2/".length) !== "docs-demo";
  }
  if (provider === "drpc") {
    return parsed.hostname === DRPC_MAINNET_RPC_HOST &&
      DRPC_MAINNET_RPC_PATH.test(parsed.pathname) &&
      parsed.pathname
        .replace(/^\/ethereum\//u, "")
        .replace(/\/$/u, "") !== "docs-demo";
  }
  return QUICKNODE_MAINNET_RPC_HOST.test(parsed.hostname) &&
    QUICKNODE_MAINNET_RPC_PATH.test(parsed.pathname) &&
    parsed.pathname.replace(/^\//u, "").replace(/\/$/u, "") !==
      "docs-demo";
}

function fixedTenderlyRecoveryBinding() {
  const parsed = new URL(TENDERLY_RECOVERY_MAINNET_RPC_URL);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "mainnet.gateway.tenderly.co" ||
    parsed.pathname !== "/" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    rpcProviderCommitment("endpoint", parsed.href) !==
      TENDERLY_RECOVERY_MAINNET_RPC_ENDPOINT_COMMITMENT
  ) {
    throw new Error("Production recovery primary RPC binding is invalid");
  }
  return Object.freeze({
    provider: "tenderly" as const,
    url: parsed.href,
    endpointCommitment: TENDERLY_RECOVERY_MAINNET_RPC_ENDPOINT_COMMITMENT,
  });
}

function strictRpcUrl(
  value: string | undefined,
  provider: MainnetRpcProviderId,
  role: "primary" | "secondary",
) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1_024 ||
    value !== value.trim()
  ) {
    throw new Error(`Website ${role} RPC binding is unavailable`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Website ${role} RPC binding is invalid`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !providerPathIsValid(parsed, provider)
  ) {
    throw new Error(`Website ${role} RPC binding is invalid`);
  }
  return parsed.href;
}

function requiredCommitment(
  value: string | undefined,
  role: "primary" | "secondary",
) {
  if (!value || !RPC_ENDPOINT_COMMITMENT.test(value)) {
    throw new Error(
      `Website ${role} RPC endpoint commitment is unavailable`,
    );
  }
  return value;
}

function binding<Provider extends MainnetRpcProviderId>(
  provider: Provider,
  rawUrl: string | undefined,
  rawCommitment: string | undefined,
  role: "primary" | "secondary",
): WebsiteRpcBinding & Readonly<{ provider: Provider }> {
  const url = strictRpcUrl(rawUrl, provider, role);
  const endpointCommitment = requiredCommitment(rawCommitment, role);
  if (rpcProviderCommitment("endpoint", url) !== endpointCommitment) {
    throw new Error(`Website ${role} RPC endpoint commitment mismatch`);
  }
  return Object.freeze({ provider, url, endpointCommitment });
}

function pair(
  source: WebsiteMainnetRpcPair["source"],
  primary: WebsiteRpcBinding,
  secondary: WebsiteRpcBinding,
): WebsiteMainnetRpcPair {
  if (
    primary.provider === secondary.provider ||
    primary.url === secondary.url ||
    primary.endpointCommitment === secondary.endpointCommitment
  ) {
    throw new Error("Website RPC providers are not independent");
  }
  return Object.freeze({ source, primary, secondary });
}

function roleBoundPair(environment: RuntimeEnvironment) {
  const primaryProvider = providerId(
    environment[WEBSITE_MAINNET_RPC_ENV.primaryProvider],
    "primary",
  );
  const secondaryProvider = providerId(
    environment[WEBSITE_MAINNET_RPC_ENV.secondaryProvider],
    "secondary",
  );
  return pair(
    "role-bound-v1",
    binding(
      primaryProvider,
      environment[WEBSITE_MAINNET_RPC_ENV.primaryUrl],
      environment[WEBSITE_MAINNET_RPC_ENV.primaryCommitment],
      "primary",
    ),
    binding(
      secondaryProvider,
      environment[WEBSITE_MAINNET_RPC_ENV.secondaryUrl],
      environment[WEBSITE_MAINNET_RPC_ENV.secondaryCommitment],
      "secondary",
    ),
  );
}

function legacyPair(environment: RuntimeEnvironment) {
  return pair(
    "legacy-alchemy-quicknode",
    binding(
      "alchemy",
      selectedLegacyValue(
        environment.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
        environment.ETHEREUM_RPC_URL,
      ),
      environment.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT,
      "primary",
    ),
    binding(
      "quicknode",
      selectedLegacyValue(
        environment.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
        environment.ETHEREUM_RPC_URL_B,
      ),
      environment.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT,
      "secondary",
    ),
  );
}

/**
 * Resolves the fixed Website read quorum. Once any role-bound v1 field is
 * configured, all six fields become mandatory and legacy values are ignored.
 * This prevents a partial provider migration from silently mixing releases.
 */
export function websiteMainnetRpcPair(
  environment: RuntimeEnvironment = process.env,
): WebsiteMainnetRpcPair {
  const roleBoundConfigured = Object.values(WEBSITE_MAINNET_RPC_ENV).some(
    (name) => environment[name] !== undefined && environment[name] !== "",
  );
  return roleBoundConfigured
    ? roleBoundPair(environment)
    : legacyPair(environment);
}

/**
 * Resolves the exact private provider pair used by public production reads and
 * action surfaces. The primary may use dRPC or Alchemy, with QuickNode as the
 * independent secondary. Every endpoint still requires its explicit role and
 * matching commitment; legacy aliases cannot select the production pair.
 */
export function productionMainnetRpcPair(
  environment: RuntimeEnvironment = process.env,
): WebsiteMainnetRpcPair {
  const resolved = roleBoundPair(environment);
  if (
    !["drpc", "alchemy"].includes(resolved.primary.provider) ||
    resolved.secondary.provider !== "quicknode"
  ) {
    throw new Error("Production RPC provider roles are invalid");
  }
  return resolved;
}

/**
 * Resolves the fixed Tenderly + commitment-bound QuickNode recovery quorum
 * used only for Custom Registry deployment verification and historical index
 * rebuilds.
 * It deliberately ignores role-bound Website and generic RPC aliases so a
 * depleted public-read primary cannot block recovery or silently change the
 * reviewed recovery endpoints. Public Profile, Claim and Trade reads must
 * continue to use the role-bound production resolvers above.
 */
export function productionRecoveryMainnetRpcPair(
  environment: RuntimeEnvironment = process.env,
): ProductionRecoveryMainnetRpcPair {
  const primary = fixedTenderlyRecoveryBinding();
  const secondary = binding(
    "quicknode",
    environment.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
    environment.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT,
    "secondary",
  );
  if (
    primary.url === secondary.url ||
    primary.endpointCommitment === secondary.endpointCommitment
  ) {
    throw new Error("Production recovery RPC provider roles are invalid");
  }
  return Object.freeze({
    source: "fixed-tenderly-quicknode-v1",
    primary,
    secondary,
  });
}

/**
 * Resolves only the commitment-bound production primary. Public read
 * paths that intentionally use one provider must not require, inspect or
 * retain a secondary binding.
 */
export function productionMainnetRpcPrimary(
  environment: RuntimeEnvironment = process.env,
): WebsiteRpcBinding {
  const primary = binding(
    providerId(
      environment[WEBSITE_MAINNET_RPC_ENV.primaryProvider],
      "primary",
    ),
    environment[WEBSITE_MAINNET_RPC_ENV.primaryUrl],
    environment[WEBSITE_MAINNET_RPC_ENV.primaryCommitment],
    "primary",
  );
  if (!["drpc", "alchemy"].includes(primary.provider)) {
    throw new Error("Production primary RPC provider role is invalid");
  }
  return primary;
}
