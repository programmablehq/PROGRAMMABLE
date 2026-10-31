import "server-only";
import { getAddress } from "viem";
import { createPrivyWalletPrincipalAuthenticatorV1, WalletPrincipalAuthenticationErrorV1,
  type AuthenticatedWalletPrincipalV1 } from "../server/creator-article/wallet-principal.server";
import { allowLocalPreview } from "./access.server";
import { CustomAIError } from "./types";
import { customAICacheScope } from "./cache-scope.server";

const freshRequests = new WeakMap<object, { request: Request; expiresAt: number }>();
const REQUEST_AUTHORITY_MAX_AGE_MS = 120_000;

export type AIAuthority = { kind: "preview" } | { kind: "account"; owner: string; principal: AuthenticatedWalletPrincipalV1 };
export async function authorizeCustomAI(request: Request, previewAllowed = false, scopeRequired = false): Promise<AIAuthority> {
  if (previewAllowed && process.env.NODE_ENV === "development" && process.env.CUSTOM_AI_LOCAL_PREVIEW === "true") {
    allowLocalPreview(request);
    return { kind: "preview" };
  }
  if (process.env.CUSTOM_AI_PUBLIC_ENABLED !== "true") throw new CustomAIError("unavailable", "Custom AI is not available here yet.", 404);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new CustomAIError("origin", "Open the builder on Programmable to continue.", 403);
  try {
    const principal = await createPrivyWalletPrincipalAuthenticatorV1().authenticate(request);
    const scope = request.headers.get("x-custom-ai-cache-scope");
    if (scopeRequired && scope === null || scope !== null && scope !== customAICacheScope(principal.privyUserId)) throw new CustomAIError("session_changed", "Reload Custom AI to open and save chats with your current signed-in account.", 409);
    const current = Object.freeze({ privyUserId: principal.privyUserId, privySessionId: principal.privySessionId,
      wallets: Object.freeze(principal.wallets.map(wallet => getAddress(wallet))) });
    const authority = Object.freeze({ kind: "account" as const, owner: current.privyUserId, principal: current });
    freshRequests.set(authority, { request, expiresAt: Date.now() + REQUEST_AUTHORITY_MAX_AGE_MS });
    return authority;
  } catch (error) {
    if (error instanceof CustomAIError) throw error;
    if (error instanceof WalletPrincipalAuthenticationErrorV1) throw new CustomAIError(error.code,
      error.status === 503 ? "Your wallet session could not be checked. Try again shortly." : "Connect your wallet to continue.", error.status);
    throw new CustomAIError("auth", "Wallet sign-in is temporarily unavailable.", 503);
  }
}


/** Request-local proof from the existing access-token/current-linked-wallet
 * check. Saved AI-job owner IDs and structural copies cannot authorize a new
 * backend submission; no second Privy user read is needed in this request. */
export function requireFreshCustomAIAuthority(request: Request, authority: AIAuthority): Extract<AIAuthority, { kind: "account" }> {
  const binding = freshRequests.get(authority);
  if (authority.kind !== "account" || !binding || binding.request !== request || Date.now() >= binding.expiresAt || request.signal.aborted)
    throw new CustomAIError("session_changed", "Check your current wallet session before preparing this launch.", 409);
  return authority;
}
