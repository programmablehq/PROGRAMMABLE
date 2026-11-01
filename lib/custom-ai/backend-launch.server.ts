import "server-only";
import { randomBytes } from "node:crypto";
import { getAddress } from "viem";
import { requireFreshCustomAIAuthority, type AIAuthority } from "./auth.server";
import { type BuilderChainId } from "./execution-routing";
import { CustomAIError } from "./types";
import { createWalletLaunchBffAssertionV1, walletLaunchMutationTargetV1, type WalletLaunchMutationV1 } from
  "@/lib/server/custom-launch/wallet-launch-bff-assertion-v1";
import { createWalletAdminBffAssertionV2, requireWalletAdminBffAssertionKeyV2 } from "@/lib/server/custom-launch/wallet-admin-bff-assertion-v2";
import type { AutomaticSourceReceipt } from "./automatic-source.server";

/** A private transport response only. Its HTTP status is never a source,
 * review, permit, wallet execution, finality or public-availability verdict. */
export type BackendLaunchReply = { httpStatus: number; value: unknown; location: string | null };
export class BackendLaunchRejected extends CustomAIError {
  constructor(readonly backendStatus: number, readonly backendCode: string | null, readonly findings: readonly unknown[]) {
    super("launch-submission", backendStatus === 403 ? "Reconnect the wallet that owns this project."
      : backendStatus === 409 ? "Refresh the saved launch preparation before continuing."
        : backendStatus === 429 ? "Launch preparation is busy. Your saved request is kept."
          : backendStatus === 422 ? "The launch review needs changes. Your source is saved."
            : backendStatus >= 500 ? "The launch service is temporarily unavailable. Your saved request is kept."
              : "The saved launch package needs a correction. Your source is kept.",
    [400, 401, 403, 409, 413, 422, 429].includes(backendStatus) ? backendStatus : 503);
  }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const unavailable = () => new CustomAIError("launch-transport", "The launch service did not return a complete response. Your saved request is kept.", 503);
async function boundedReply(response: Response, maximum: number) {
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel().catch(() => undefined); throw unavailable();
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel().catch(() => undefined); throw unavailable();
  }
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw unavailable(); }
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
  } finally { reader.releaseLock(); }
}

/** This bridge cannot authenticate from a stored job ID, issue an API key or
 * choose a fallback chain. The current Request authority and linked wallet are
 * required immediately before sending the one body-bound backend mutation. */
export function createCustomAIBackendLaunchBridge(input: Readonly<{
  backendBaseUrl: string; websiteToken: string; assertionKey: string; fetchBackend: typeof fetch;
  now?: () => Date; nonce?: () => string; timeoutMs?: number; maximumReplyBytes?: number;
}>) {
  const base = new URL(input.backendBaseUrl);
  const timeoutMs = input.timeoutMs ?? 110_000, maximum = input.maximumReplyBytes ?? 64 * 1024 * 1024;
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash
    || typeof input.websiteToken !== "string" || input.websiteToken.length < 43 || input.websiteToken.length > 512 || /\s|\0/u.test(input.websiteToken)
    || typeof input.fetchBackend !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 110_000
    || !Number.isSafeInteger(maximum) || maximum < 64 || maximum > 64 * 1024 * 1024)
    throw new TypeError("Custom AI launch backend configuration is invalid");
  const key = requireWalletAdminBffAssertionKeyV2(input.assertionKey, input.websiteToken);
  return Object.freeze({
    async automaticReview(request:Request,authority:AIAuthority,candidate:Readonly<{
      account:`0x${string}`;reviewId:string;
    } & ({operation:"bind-source";receipt:AutomaticSourceReceipt}|{operation:"check"|"status"})>):Promise<BackendLaunchReply> {
      const method=candidate.operation==="status"?"GET":"POST";
      if(request.method!==method)throw new CustomAIError("launch-method","Use the explicit launch action to run automatic checks.",405);
      const current=requireFreshCustomAIAuthority(request,authority),account=getAddress(candidate.account);
      if(!current.principal.wallets.some(wallet=>getAddress(wallet)===account))
        throw new CustomAIError("wallet","Select the wallet that owns this saved submission.",403);
      if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(candidate.reviewId))throw unavailable();
      if(candidate.operation==="bind-source"&&(candidate.receipt.reviewId!==candidate.reviewId
        ||candidate.receipt.controller.toLowerCase()!==account.toLowerCase()))throw unavailable();
      const target=`/v1/wallet-admin/custom-ai/launch-reviews/${candidate.reviewId}${candidate.operation==="bind-source"?"/source-context":""}`;
      const bytes=Buffer.from(candidate.operation==="status"?"":JSON.stringify(candidate.operation==="bind-source"?{receipt:candidate.receipt}:{action:"check"}));
      if(bytes.byteLength>262_144)throw new CustomAIError("automatic-source-size","This saved design is too large for automatic review.",413);
      const assertion=createWalletAdminBffAssertionV2({method,requestTarget:target,privyUserId:current.principal.privyUserId,
        walletAddress:account,issuedAt:(input.now?.()??new Date()).toISOString(),nonce:input.nonce?.()??randomBytes(16).toString("base64url"),
        bodyBytes:bytes,assertionKey:key});
      try {
        const response=await input.fetchBackend(new URL(target,base),{method,cache:"no-store",redirect:"error",
          signal:AbortSignal.any([request.signal,AbortSignal.timeout(Math.min(candidate.operation==="check"?65_000:10_000,timeoutMs))]),
          headers:{Accept:"application/json",Authorization:`Bearer ${input.websiteToken}`,"Content-Type":"application/json",
            "X-Programmable-Privy-User-Id":current.principal.privyUserId,"X-Programmable-Wallet-Address":account.toLowerCase(),...assertion},
          ...(method==="POST"?{body:bytes}:{})});
        if(response.status>=300&&response.status<400){await response.body?.cancel().catch(()=>undefined);throw unavailable();}
        const value=await boundedReply(response,48_000),object=record(value);
        if(!response.ok){const error=record(object?.error);throw new BackendLaunchRejected(response.status,
          typeof error?.code==="string"&&/^[A-Z][A-Z0-9_]{1,127}$/u.test(error.code)?error.code:null,[]);}
        if(object?.reviewId!==candidate.reviewId||response.headers.get("location")!==null)throw unavailable();
        if(candidate.operation==="bind-source"){
          if(object.schemaVersion!=="programmable.automatic-source-bound.v1"||object.bound!==true||response.status!==200)throw unavailable();
        }else if(object.schemaVersion!=="programmable.automatic-launch-status.v1"||object.manualReviewRequired!==false||object.launchReady!==false
          ||!["not_started","checking","approved","changes_required","interrupted"].includes(String(object.state))
          ||![200,202].includes(response.status))throw unavailable();
        return {httpStatus:response.status,value,location:null};
      }catch(error){if(error instanceof CustomAIError)throw error;throw unavailable();}
    },
    async status(request: Request, authority: AIAuthority, candidate: Readonly<{
      chainId: BuilderChainId; account: `0x${string}`; resourceId: string;
    }>): Promise<BackendLaunchReply> {
      if (request.method !== "GET") throw new CustomAIError("launch-method", "Read the saved launch status with GET.", 405);
      const current = requireFreshCustomAIAuthority(request, authority), account = getAddress(candidate.account);
      if (!current.principal.wallets.some(wallet => getAddress(wallet) === account))
        throw new CustomAIError("wallet", "Select the wallet that owns this saved submission.", 403);
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(candidate.resourceId))
        throw new CustomAIError("launch-status", "Open the original saved submission.", 400);
      const target = `${walletLaunchMutationTargetV1(candidate.chainId, "create")}/${candidate.resourceId}?view=status`;
      const assertion = createWalletAdminBffAssertionV2({ method: "GET", requestTarget: target, privyUserId: current.principal.privyUserId,
        walletAddress: account, issuedAt: (input.now?.() ?? new Date()).toISOString(), nonce: input.nonce?.() ?? randomBytes(16).toString("base64url"),
        bodyBytes: Buffer.alloc(0), assertionKey: key });
      try {
        const response = await input.fetchBackend(new URL(target, base), { method: "GET", cache: "no-store", redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(Math.min(10_000, timeoutMs))]), headers: {
            Accept: "application/json", Authorization: `Bearer ${input.websiteToken}`, "X-Programmable-Privy-User-Id": current.principal.privyUserId,
            "X-Programmable-Wallet-Address": account.toLowerCase(), ...assertion,
          } });
        if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); throw unavailable(); }
        const value = await boundedReply(response, 4096);
        return { httpStatus: 200, value, location: null };
      } catch (error) { if (error instanceof CustomAIError) throw error; throw unavailable(); }
    },
    async submit(request: Request, authority: AIAuthority, candidate: Readonly<{
      chainId: BuilderChainId; operation: WalletLaunchMutationV1; account: `0x${string}`;
      bodyBytes: Uint8Array; idempotencyKey: string | null;
    }>): Promise<BackendLaunchReply> {
      if (request.method !== "POST") throw new CustomAIError("launch-method", "Prepare this launch with an explicit request.", 405);
      const current = requireFreshCustomAIAuthority(request, authority), account = getAddress(candidate.account);
      if (!current.principal.wallets.some(wallet => getAddress(wallet) === account))
        throw new CustomAIError("wallet", "Select a wallet linked to your current account.", 403);
      if (!(candidate.bodyBytes instanceof Uint8Array) || candidate.bodyBytes.byteLength < 2
        || candidate.bodyBytes.byteLength > (candidate.chainId === 4663 ? 16_777_216 : 8_388_608))
        throw new CustomAIError("launch-package-size", "This launch package exceeds the network's source limit.", 413);
      const bytes = Buffer.from(candidate.bodyBytes), responseVersion = candidate.chainId === 4663 ? "1.2" as const : null;
      const target = walletLaunchMutationTargetV1(candidate.chainId, candidate.operation);
      const assertion = createWalletLaunchBffAssertionV1({ chainId: candidate.chainId, operation: candidate.operation,
        privyUserId: current.principal.privyUserId, walletAddress: account, issuedAt: (input.now?.() ?? new Date()).toISOString(),
        nonce: input.nonce?.() ?? randomBytes(16).toString("base64url"), bodyBytes: bytes, idempotencyKey: candidate.idempotencyKey,
        responseVersion, assertionKey: key });
      try {
        const response = await input.fetchBackend(new URL(target, base), { method: "POST", cache: "no-store", redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]), headers: {
            Accept: "application/json", Authorization: `Bearer ${input.websiteToken}`, "Content-Type": "application/json",
            "X-Programmable-Privy-User-Id": current.principal.privyUserId, "X-Programmable-Wallet-Address": account.toLowerCase(),
            ...(candidate.idempotencyKey === null ? {} : { "Idempotency-Key": candidate.idempotencyKey }),
            ...(responseVersion === null ? {} : { "Programmable-Launch-Response-Version": responseVersion }), ...assertion,
          }, body: bytes });
        if (response.status >= 300 && response.status < 400) { await response.body?.cancel().catch(() => undefined); throw unavailable(); }
        const value = await boundedReply(response, maximum);
        if (!response.ok) {
          const object = record(value), error = record(object?.error), code = error?.code;
          const findings = Array.isArray(object?.findings) ? object.findings.slice(0, 32) : [];
          throw new BackendLaunchRejected(response.status, typeof code === "string" && /^[A-Z][A-Z0-9_]{1,127}$/u.test(code) ? code : null, findings);
        }
        const location = response.headers.get("location");
        if (location !== null) {
          const url = new URL(location, base), resourceBase = walletLaunchMutationTargetV1(candidate.chainId, "create");
          if (url.origin !== base.origin || url.search || url.hash || !url.pathname.startsWith(`${resourceBase}/`)
            || !/^[A-Za-z0-9-]{16,128}$/u.test(url.pathname.slice(resourceBase.length + 1))) throw unavailable();
        }
        return { httpStatus: response.status, value, location };
      } catch (error) {
        if (error instanceof CustomAIError) throw error;
        throw unavailable();
      }
    },
  });
}
