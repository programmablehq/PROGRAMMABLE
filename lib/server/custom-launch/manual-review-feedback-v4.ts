import { reviewLinksV4, REVIEW_UUID_V4 } from "@/lib/custom-launch-review-workflow";
import "server-only";
import { randomBytes } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { parseCustomLaunchReview } from "@/lib/custom-launch-review";
import { tryParseViewChainId } from "@/lib/view-chain";
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

export function createManualReviewFeedbackBridgeV4(input: { authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string; websiteToken: string; bffAssertionKeyV2: string; fetchBackend: typeof fetch }) {
  const base = new URL(input.backendBaseUrl);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid review backend");
  const assertionKey = requireWalletAdminBffAssertionKeyV2(input.bffAssertionKeyV2, input.websiteToken);
  return async (request: Request) => {
    const respond = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Authorization, X-Privy-Identity-Token" } });
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.search || request.headers.get("origin") && request.headers.get("origin") !== url.origin) return respond(400, { error: "Invalid review request." });
      const principal = await input.authenticator.authenticate(request);
      let value;
      try { value = JSON.parse(await readBoundedBody(request, 20000)); }
      catch (error) { if (error instanceof StartInputError) throw error; throw new StartInputError(400); }
      const keys = value?.operation === "ownerRead" ? "chainId,launchId,operation,walletAddress" : value?.operation === "reply"
        ? "chainId,launchId,links,message,operation,revision,subjectHash,walletAddress" : "chainId,launchId,operation,replacementReviewId,revision,subjectHash,walletAddress";
      if (!value || Array.isArray(value) || !["ownerRead", "reply", "replace"].includes(value.operation)
        || Object.keys(value).sort().join(",") !== keys || typeof value.chainId !== "string"
        || tryParseViewChainId(value.chainId) === null || !REVIEW_UUID_V4.test(value.launchId)
        || typeof value.walletAddress !== "string" || !isAddress(value.walletAddress)
        || (value.operation !== "ownerRead" && (!/^sha256:[0-9a-f]{64}$/u.test(value.subjectHash) || !Number.isSafeInteger(value.revision) || value.revision < 1))
        || (value.operation === "reply" && (typeof value.message !== "string" || !value.message.trim() || value.message.length > 12000 || !reviewLinksV4(value.links)))
        || (value.operation === "replace" && !REVIEW_UUID_V4.test(value.replacementReviewId))) return respond(400, { error: "Invalid review message." });
      if (!principal.wallets.some(wallet => wallet.toLowerCase() === value.walletAddress.toLowerCase())) return respond(403, { error: "Connect the wallet that submitted this launch." });
      const target = new URL("/v1/wallet-admin/custom-launch-reviews/feedback", base);
      const { walletAddress: _walletAddress, ...payload } = value;
      const body = Buffer.from(JSON.stringify(payload));
      const assertion = createWalletAdminBffAssertionV2({ method: "POST", requestTarget: target.pathname,
        privyUserId: principal.privyUserId, walletAddress: getAddress(value.walletAddress), issuedAt: new Date().toISOString(),
        nonce: randomBytes(16).toString("base64url"), bodyBytes: body, assertionKey });
      const response = await input.fetchBackend(target, { method: "POST", body: body.toString("utf8"),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.websiteToken}`,
          "X-Programmable-Privy-User-Id": principal.privyUserId, "X-Programmable-Wallet-Address": getAddress(value.walletAddress), ...assertion },
        cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(value.operation === "ownerRead" ? 65000 : 15000)]) });
      if (!response.ok) {
        const status = [400, 403, 404, 409, 429].includes(response.status) ? response.status : 503;
        if (value.operation === "ownerRead") return respond(status, { error: status === 404
          ? "No review was found for this launch and wallet on the selected chain." : "Could not load review details. Try again." });
        return respond(status, { error: status === 409 ? "This review changed. Refresh before sending." : "Could not update this review. Try again." });
      }
      const result = JSON.parse(await readBoundedBody(response, 1024 * 1024));
      return respond(200, { review: parseCustomLaunchReview(result.review), ...(value.operation === "ownerRead" && result.assessment ? { assessment: result.assessment } : {}) });
    } catch (error) { return respond(error instanceof WalletPrincipalAuthenticationErrorV1 || error instanceof StartInputError ? error.status : 503, { error: "Could not complete this review request. Check your wallet connection and try again." }); }
  };
}

export async function sendReviewedLaunchFeedbackV4(request: Request) {
  try { return await createManualReviewFeedbackBridgeV4({ authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    backendBaseUrl: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL!, websiteToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN!,
    bffAssertionKeyV2: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2!, fetchBackend: fetch })(request); }
  catch { return Response.json({ error: "Review messages are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
