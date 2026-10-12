import { reviewLinksV4 } from "@/lib/custom-launch-review-workflow";
import "server-only";
import { randomBytes } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { isWebsiteAdminWallet } from "@/lib/admin-access";
import { parseCustomLaunchReview } from "@/lib/custom-launch-review";
import { createPrivyWalletPrincipalAuthenticatorV1, WalletPrincipalAuthenticationErrorV1, type WalletPrincipalAuthenticatorV1 } from "../creator-article/wallet-principal.server";
import { createWalletAdminBffAssertionV2, requireWalletAdminBffAssertionKeyV2 } from "./wallet-admin-bff-assertion-v2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Authorization, X-Privy-Identity-Token" };
class InputError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
async function boundedBody(message: Request | Response, maximum: number) {
  const reader = message.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) { await reader.cancel(); throw new InputError(413, "REVIEW_BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export function createManualReviewBridgeV1(input: {
  authenticator: WalletPrincipalAuthenticatorV1; backendBaseUrl: string; websiteToken: string; bffAssertionKeyV2: string;
  fetchBackend: typeof fetch; now?: () => Date;
}) {
  const base = new URL(input.backendBaseUrl);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid review backend");
  const assertionKey = requireWalletAdminBffAssertionKeyV2(input.bffAssertionKeyV2, input.websiteToken);
  return async (request: Request): Promise<Response> => {
    try {
      if (!["GET", "POST"].includes(request.method)) throw new InputError(405, "METHOD_NOT_ALLOWED");
      const url = new URL(request.url);
      if (request.headers.get("origin") && request.headers.get("origin") !== url.origin) throw new InputError(403, "ORIGIN_MISMATCH");
      if ([...url.searchParams.keys()].some(key => !["walletAddress", "reviewId"].includes(key))
        || url.searchParams.getAll("walletAddress").length !== 1 || url.searchParams.getAll("reviewId").length > 1) throw new InputError(400, "REVIEW_REQUEST_INVALID");
      const wallet = url.searchParams.get("walletAddress");
      if (!wallet || !isAddress(wallet)) throw new InputError(400, "WALLET_INVALID");
      const principal = await input.authenticator.authenticate(request);
      if (!isWebsiteAdminWallet(wallet) || !principal.wallets.some(candidate => candidate.toLowerCase() === wallet.toLowerCase())) throw new InputError(403, "REVIEW_ADMIN_REQUIRED");
      const reviewId = url.searchParams.get("reviewId");
      if (reviewId !== null && (!UUID.test(reviewId) || request.method !== "GET")) throw new InputError(400, "REVIEW_REQUEST_INVALID");
      let body: Buffer | undefined;
      if (request.method === "POST") {
        let value;
        try { value = JSON.parse(await boundedBody(request, 20000)); } catch (error) { if (error instanceof InputError) throw error; throw new InputError(400, "REVIEW_DECISION_INVALID"); }
        const collaborative = value && ["request_information", "replace", "record_checks"].includes(value.operation);
        if (collaborative) {
          const keys = value.operation === "record_checks" ? "operation,report,reviewId,revision,subjectHash" : value.operation === "replace" ? "operation,replacementReviewId,reviewId,revision,subjectHash" : "links,message,operation,reviewId,revision,subjectHash";
          if (Object.keys(value).sort().join(",") !== keys || !UUID.test(value.reviewId) || !/^sha256:[0-9a-f]{64}$/u.test(value.subjectHash)
            || !Number.isSafeInteger(value.revision) || value.revision < 1
            || (value.operation === "record_checks" ? !value.report || typeof value.report !== "object" || JSON.stringify(value.report).length > 12000
              : value.operation === "replace" ? !UUID.test(value.replacementReviewId) : typeof value.message !== "string" || !value.message.trim() || value.message.length > 12000 || !reviewLinksV4(value.links))) throw new InputError(400, "REVIEW_MESSAGE_INVALID");
        } else if (!value || typeof value !== "object" || Array.isArray(value)
          || Object.keys(value).sort().join(",") !== "decision,reason,reviewId,revision,subjectHash"
          || !UUID.test(value.reviewId) || !/^sha256:[0-9a-f]{64}$/u.test(value.subjectHash)
          || !Number.isSafeInteger(value.revision) || value.revision < 1 || !["approve", "reject"].includes(value.decision)
          || typeof value.reason !== "string" || value.reason.length > 2000) throw new InputError(400, "REVIEW_DECISION_INVALID");
        body = Buffer.from(JSON.stringify(value));
      }
      const target = new URL("/v1/admin/custom-launch-reviews", base);
      if (reviewId) target.searchParams.set("reviewId", reviewId);
      const assertion = createWalletAdminBffAssertionV2({ method: request.method === "POST" ? "POST" : "GET", requestTarget: target.pathname + target.search,
        privyUserId: principal.privyUserId, walletAddress: getAddress(wallet), issuedAt: (input.now?.() ?? new Date()).toISOString(),
        nonce: randomBytes(16).toString("base64url"), bodyBytes: body ?? Buffer.alloc(0), assertionKey });
      const backend = await input.fetchBackend(target, { method: request.method, body: body?.toString("utf8"),
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${input.websiteToken}`,
          "X-Programmable-Privy-User-Id": principal.privyUserId, "X-Programmable-Wallet-Address": getAddress(wallet), ...assertion },
        cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(reviewId || request.method === "POST" ? 60_000 : 12_000)]) });
      if (backend.status === 409) {
        const error = JSON.parse(await boundedBody(backend, 65536));
        const code = ["REVIEW_EMBEDDED_DEADLINE_TOO_SHORT", "REVIEW_REPLAN_REQUIRED", "REVIEW_PLATFORM_FEE_EVIDENCE_REQUIRED"].includes(error?.error?.code) ? error.error.code : "REVIEW_CHANGED_REFRESH";
        return Response.json({ error: { code } }, { status: 409, headers });
      }
      if (!backend.ok) throw new InputError([400, 403, 404, 409].includes(backend.status) ? backend.status : 503,
        backend.status === 409 ? "REVIEW_CHANGED_REFRESH" : "REVIEW_UNAVAILABLE");
      const value = JSON.parse(await boundedBody(backend, reviewId ? 64 * 1024 * 1024 : 8 * 1024 * 1024));
      if (request.method === "GET" && !reviewId) {
        if (!Array.isArray(value.reviews) || value.reviews.length > 100) throw new Error("Invalid review list");
        value.reviews.forEach(parseCustomLaunchReview);
      } else parseCustomLaunchReview(value.review);
      return new Response(JSON.stringify(value), { headers });
    } catch (error) {
      const known = error instanceof InputError || error instanceof WalletPrincipalAuthenticationErrorV1;
      return new Response(JSON.stringify({ error: { code: known ? error.code : "REVIEW_UNAVAILABLE" } }), { status: known ? error.status : 503, headers });
    }
  };
}
export async function routeProductionManualReviewsV1(request: Request) {
  try {
    return await createManualReviewBridgeV1({ authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
      backendBaseUrl: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL!, websiteToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN!,
      bffAssertionKeyV2: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2!, fetchBackend: fetch })(request);
  } catch { return new Response(JSON.stringify({ error: { code: "REVIEW_UNAVAILABLE" } }), { status: 503, headers }); }
}
