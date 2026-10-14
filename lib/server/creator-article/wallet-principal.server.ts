import "server-only";

import { privyReadClient, readCurrentPrivyUser, privyReadUnavailable } from "../privy-read-client";
import { getAddress, isAddress } from "viem";

import { parseStrictJson, type JsonValue } from
  "../projection-target/canonical-json";

const MAXIMUM_PRIVY_TOKEN_BYTES = 131_072;

export type AuthenticatedWalletPrincipalV1 = Readonly<{
  privyUserId: string;
  privySessionId: string;
  wallets: readonly `0x${string}`[];
}>;

export interface WalletPrincipalAuthenticatorV1 {
  authenticate(request: Request): Promise<AuthenticatedWalletPrincipalV1>;
}

export interface PrivyWalletAuthorityBoundaryV1 {
  verifyAccessToken(token: string): Promise<Readonly<{
    appId: string;
    userId: string;
    sessionId: string;
  }>>;
  verifyIdentityToken(token: string): Promise<Readonly<{
    userId: string;
    sessionId: string;
  }>>;
  getCurrentUser(userId: string): Promise<Readonly<{
    id: string;
    linkedAccounts: readonly Readonly<{
      type: string;
      address?: string;
      chainType?: string;
    }>[];
  }>>;
}

export class WalletPrincipalAuthenticationErrorV1 extends Error {
  constructor(readonly status: 401 | 403 | 503, readonly code: string) {
    super(code);
    this.name = "WalletPrincipalAuthenticationErrorV1";
  }
}

export function createPrivyWalletPrincipalAuthenticatorV1():
WalletPrincipalAuthenticatorV1 {
  const appId = requiredEnvironment("NEXT_PUBLIC_PRIVY_APP_ID");
  const appSecret = requiredEnvironment("PRIVY_APP_SECRET");
  const privy = privyReadClient(appId, appSecret);
  return createWalletPrincipalAuthenticatorFromBoundaryV1({
    appId,
    boundary: Object.freeze({
      async verifyAccessToken(token: string) {
        const value = await privy.utils().auth().verifyAccessToken(token);
        return Object.freeze({
          appId: value.app_id,
          userId: value.user_id,
          sessionId: value.session_id,
        });
      },
      async verifyIdentityToken(token: string) {
        const user = await privy.users().get({ id_token: token });
        const claims = verifiedIdentitySessionClaims(token);
        if (claims.userId !== user.id) throw new TypeError("Privy identity mismatch");
        return claims;
      },
      async getCurrentUser(userId: string) {
        const user = await readCurrentPrivyUser(privy, userId);
        return Object.freeze({
          id: user.id,
          linkedAccounts: Object.freeze(user.linked_accounts.map((account) => {
            const record = account as unknown as Record<string, unknown>;
            return Object.freeze({
              type: account.type,
              ...(typeof record.address === "string"
                ? { address: record.address }
                : {}),
              ...(typeof record.chain_type === "string"
                ? { chainType: record.chain_type }
                : {}),
            });
          })),
        });
      },
    }),
  });
}

export function createWalletPrincipalAuthenticatorFromBoundaryV1(
  input: Readonly<{
    appId: string;
    boundary: PrivyWalletAuthorityBoundaryV1;
  }>,
): WalletPrincipalAuthenticatorV1 {
  if (!input.appId
    || typeof input.boundary?.verifyAccessToken !== "function"
    || typeof input.boundary.verifyIdentityToken !== "function"
    || typeof input.boundary.getCurrentUser !== "function") {
    throw new TypeError("Privy wallet authority boundary is invalid");
  }
  return Object.freeze({
    async authenticate(request: Request): Promise<AuthenticatedWalletPrincipalV1> {
      const accessToken = bearerToken(request.headers.get("authorization"));
      const identityHeader = request.headers.get("x-privy-identity-token");
      // Privy can return a current user without issuing an identity token.
      // The access token remains mandatory and verified; when an identity
      // token is available, bind it to the exact same user and session.
      const identityToken = identityHeader === null
        ? null
        : boundedToken(identityHeader, "identity_token_invalid");
      try {
        const [access, identity] = await Promise.all([
          input.boundary.verifyAccessToken(accessToken),
          identityToken === null
            ? Promise.resolve(null)
            : input.boundary.verifyIdentityToken(identityToken),
        ]);
        if (
          access.appId !== input.appId
          || (identity !== null && (
            access.userId !== identity.userId
            || access.sessionId !== identity.sessionId
          ))
        ) throw new TypeError("Privy token binding mismatch");
        const user = await input.boundary.getCurrentUser(access.userId);
        if (user.id !== access.userId) throw new TypeError("Privy user mismatch");
        const wallets = new Map<string, `0x${string}`>();
        for (const account of user.linkedAccounts) {
          if (
            account.type !== "wallet"
            || (account.chainType !== undefined && account.chainType !== "ethereum")
            || typeof account.address !== "string"
            || !isAddress(account.address)
          ) continue;
          const address = getAddress(account.address);
          wallets.set(address.toLowerCase(), address);
        }
        const normalized = [...wallets.values()].sort((left, right) =>
          left.toLowerCase().localeCompare(right.toLowerCase()));
        if (normalized.length === 0) {
          throw new WalletPrincipalAuthenticationErrorV1(403, "ethereum_wallet_required");
        }
        return Object.freeze({
          privyUserId: user.id,
          privySessionId: access.sessionId,
          wallets: Object.freeze(normalized),
        });
      } catch (error) {
        if (error instanceof WalletPrincipalAuthenticationErrorV1) throw error;
        if (privyReadUnavailable(error)) throw new WalletPrincipalAuthenticationErrorV1(503, "wallet_session_unavailable");
        throw new WalletPrincipalAuthenticationErrorV1(401, "privy_session_rejected");
      }
    },
  });
}

function bearerToken(value: string | null) {
  if (!value?.startsWith("Bearer ")) {
    throw new WalletPrincipalAuthenticationErrorV1(401, "session_required");
  }
  return boundedToken(value.slice("Bearer ".length), "access_token_invalid");
}

function boundedToken(value: string | null, code: string) {
  if (
    value === null
    || value.length < 20
    || Buffer.byteLength(value, "utf8") > MAXIMUM_PRIVY_TOKEN_BYTES
    || /[\s\u0000]/u.test(value)
  ) throw new WalletPrincipalAuthenticationErrorV1(401, code);
  return value;
}

function verifiedIdentitySessionClaims(token: string) {
  const segments = token.split(".");
  if (segments.length !== 3 || segments[1] === undefined) {
    throw new TypeError("Privy identity token is invalid");
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.from(segments[1], "base64url"),
  );
  const value = parseStrictJson(decoded, {
    maximumBytes: MAXIMUM_PRIVY_TOKEN_BYTES,
    maximumDepth: 16,
  });
  const record = jsonRecord(value);
  if (
    typeof record.sub !== "string" || !record.sub
    || typeof record.sid !== "string" || !record.sid
    || record.sub.length > 512 || record.sid.length > 512
  ) throw new TypeError("Privy identity token session is invalid");
  return Object.freeze({ userId: record.sub, sessionId: record.sid });
}

function jsonRecord(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Privy identity token payload is invalid");
  }
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}
