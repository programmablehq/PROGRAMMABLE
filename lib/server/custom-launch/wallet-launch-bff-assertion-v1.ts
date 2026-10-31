import "server-only";
import { createHash, createHmac } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { builderChain, type BuilderChainId } from "@/lib/custom-ai/execution-routing";
import { requireWalletAdminBffAssertionKeyV2 } from "./wallet-admin-bff-assertion-v2";

export type WalletLaunchMutationV1 = "create" | "preflight";
export function walletLaunchMutationTargetV1(chainId: BuilderChainId, operation: WalletLaunchMutationV1): string {
  if (operation !== "create" && operation !== "preflight") throw new TypeError("Wallet launch operation is invalid");
  const chain = builderChain(chainId), target = operation === "create" ? chain.createPath : chain.preflightPath;
  if (!target.includes("/custom-launch")) throw new TypeError("Wallet launch route is not configured");
  return target.replace("/custom-launch", "/wallet-admin/custom-launch");
}

/** Additive version 3 has its own domain and also binds idempotency/response
 * negotiation. Existing V2 readers retain their original NUL-framed format. */
export function createWalletLaunchBffAssertionV1(input: Readonly<{
  chainId: BuilderChainId; operation: WalletLaunchMutationV1; privyUserId: string;
  walletAddress: `0x${string}`; issuedAt: string; nonce: string;
  bodyBytes: Uint8Array; idempotencyKey: string | null; responseVersion: "1.0" | "1.1" | "1.2" | null;
  assertionKey: string;
}>) {
  const requestTarget = walletLaunchMutationTargetV1(input.chainId, input.operation);
  let date: string;
  try { date = new Date(input.issuedAt).toISOString(); } catch { throw new TypeError("Wallet launch assertion time is invalid"); }
  if (date !== input.issuedAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(date)
    || !/^[A-Za-z0-9_-]{22}$/u.test(input.nonce) || Buffer.from(input.nonce, "base64url").toString("base64url") !== input.nonce
    || !input.privyUserId || input.privyUserId !== input.privyUserId.trim() || input.privyUserId.length > 1024
    || /[\u0000-\u001f\u007f]/u.test(input.privyUserId) || !isAddress(input.walletAddress)
    || !(input.bodyBytes instanceof Uint8Array) || input.bodyBytes.byteLength < 2
    || input.bodyBytes.byteLength > (input.chainId === 4663 ? 16_777_216 : 8_388_608)
    || (input.operation === "create" ? typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/u.test(input.idempotencyKey) : input.idempotencyKey !== null)
    || (input.responseVersion !== null && (input.chainId !== 4663 || !["1.0", "1.1", "1.2"].includes(input.responseVersion))))
    throw new TypeError("Wallet launch assertion input is invalid");
  const assertionKey = requireWalletAdminBffAssertionKeyV2(input.assertionKey, "");
  const walletAddress = getAddress(input.walletAddress).toLowerCase();
  const bodySha256 = `sha256:${createHash("sha256").update(input.bodyBytes).digest("hex")}`;
  const signature = createHmac("sha256", assertionKey).update([
    "programmable.custom-launch-api.wallet-launch-assertion.v1", "3", "POST", requestTarget,
    input.privyUserId, walletAddress, date, input.nonce, bodySha256, input.idempotencyKey ?? "", input.responseVersion ?? "",
  ].join("\n"), "utf8").digest("hex");
  return Object.freeze({
    "X-Programmable-Bff-Assertion-Version": "3",
    "X-Programmable-Bff-Assertion-Issued-At": date,
    "X-Programmable-Bff-Assertion-Nonce": input.nonce,
    "X-Programmable-Bff-Assertion-Body-Sha256": bodySha256,
    "X-Programmable-Bff-Assertion-Signature": `hmac-sha256:${signature}`,
  });
}
