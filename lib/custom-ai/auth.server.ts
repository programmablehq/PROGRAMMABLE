import "server-only";
import { createPrivyWalletPrincipalAuthenticatorV1, WalletPrincipalAuthenticationErrorV1,
  type AuthenticatedWalletPrincipalV1 } from "../server/creator-article/wallet-principal.server";
import { allowLocalPreview } from "./access.server";
import { CustomAIError } from "./types";

export type AIAuthority = { kind: "preview" } | { kind: "account"; owner: string; principal: AuthenticatedWalletPrincipalV1 };
export async function authorizeCustomAI(request: Request, previewAllowed = false): Promise<AIAuthority> {
  if (previewAllowed && process.env.NODE_ENV === "development" && process.env.CUSTOM_AI_LOCAL_PREVIEW === "true") {
    allowLocalPreview(request);
    return { kind: "preview" };
  }
  if (process.env.CUSTOM_AI_PUBLIC_ENABLED !== "true") throw new CustomAIError("unavailable", "Custom AI is not available here yet.", 404);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new CustomAIError("origin", "Open the builder on Programmable to continue.", 403);
  try {
    const principal = await createPrivyWalletPrincipalAuthenticatorV1().authenticate(request);
    return { kind: "account", owner: principal.privyUserId, principal };
  } catch (error) {
    if (error instanceof WalletPrincipalAuthenticationErrorV1) throw new CustomAIError(error.code,
      error.status === 503 ? "Your wallet session could not be checked. Try again shortly." : "Connect your wallet to continue.", error.status);
    throw new CustomAIError("auth", "Wallet sign-in is temporarily unavailable.", 503);
  }
}
