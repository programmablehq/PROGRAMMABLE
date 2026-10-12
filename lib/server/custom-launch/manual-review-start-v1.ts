import "server-only";
import { randomBytes } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { parseCustomLaunchReview } from "@/lib/custom-launch-review";
import { createPrivyWalletPrincipalAuthenticatorV1, WalletPrincipalAuthenticationErrorV1, type WalletPrincipalAuthenticatorV1 } from "../creator-article/wallet-principal.server";
import { createWalletAdminBffAssertionV2, requireWalletAdminBffAssertionKeyV2 } from "./wallet-admin-bff-assertion-v2";

class StartInputError extends Error { constructor(readonly status: number) { super("Invalid launch request"); } }
async function readBoundedBody(message: Request | Response, maximum: number) {
  const reader = message.body?.getReader();
  if (!reader) throw new StartInputError(400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > maximum) { await reader.cancel(); throw new StartInputError(413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export function createManualReviewStartBridgeV1(input: { authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string; websiteToken: string; bffAssertionKeyV2: string; fetchBackend: typeof fetch }) {
  const base = new URL(input.backendBaseUrl);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid review backend");
  const assertionKey = requireWalletAdminBffAssertionKeyV2(input.bffAssertionKeyV2, input.websiteToken);
  return async (request: Request) => {
    const respond = (status: number, body: unknown, retryAfter?: string | null) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Authorization, X-Privy-Identity-Token",
      ...(retryAfter && retryAfter.length <= 100 && (/^\d+$/.test(retryAfter) || Number.isFinite(Date.parse(retryAfter))) ? { "Retry-After": retryAfter } : {}) } });
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.search || request.headers.get("origin") && request.headers.get("origin") !== url.origin) return respond(400, { error: "Invalid launch start request." });
      const principal = await input.authenticator.authenticate(request);
      let value;
      try { value = JSON.parse(await readBoundedBody(request, 1024)); }
      catch (error) { if (error instanceof StartInputError) throw error; throw new StartInputError(400); }
      if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== "chainId,launchId,walletAddress"
        || !["1", "4663"].includes(value.chainId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.launchId)
        || typeof value.walletAddress !== "string" || !isAddress(value.walletAddress)) return respond(400, { error: "Invalid launch request." });
      if (!principal.wallets.some(wallet => wallet.toLowerCase() === value.walletAddress.toLowerCase())) return respond(403, { error: "Connect the wallet that submitted this launch." });
      const target = new URL("/v1/wallet-admin/custom-launch-reviews/start", base);
      const body = Buffer.from(JSON.stringify({ chainId: value.chainId, launchId: value.launchId }));
      const assertion = createWalletAdminBffAssertionV2({ method: "POST", requestTarget: target.pathname,
        privyUserId: principal.privyUserId, walletAddress: getAddress(value.walletAddress), issuedAt: new Date().toISOString(),
        nonce: randomBytes(16).toString("base64url"), bodyBytes: body, assertionKey });
      const response = await input.fetchBackend(target, { method: "POST", body: body.toString("utf8"),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.websiteToken}`,
          "X-Programmable-Privy-User-Id": principal.privyUserId, "X-Programmable-Wallet-Address": getAddress(value.walletAddress), ...assertion },
        cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) return respond([400, 401, 403, 404, 409, 429].includes(response.status) ? response.status : 503, { error: response.status === 409 ? "This approval is no longer active. Refresh your launch."
        : response.status === 401 ? "Sign in again to prepare your launch."
        : response.status === 403 ? "Connect the wallet that submitted this launch."
        : "Launch preparation is temporarily unavailable." }, response.headers.get("Retry-After"));
      const result = JSON.parse(await readBoundedBody(response, 1024 * 1024));
      return respond(200, { review: parseCustomLaunchReview(result.review) });
    } catch (error) { return respond(error instanceof WalletPrincipalAuthenticationErrorV1 || error instanceof StartInputError ? error.status : 503, { error: "Could not start this launch. Reconnect your wallet and try again." }); }
  };
}

export async function startReviewedLaunchV1(request: Request) {
  try { return await createManualReviewStartBridgeV1({ authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    backendBaseUrl: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL!, websiteToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN!,
    bffAssertionKeyV2: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2!, fetchBackend: fetch })(request); }
  catch { return Response.json({ error: "Launch preparation is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
