import "server-only";
import { createHash } from "node:crypto";

export type CreateDisposition = {
  schemaVersion: "programmable.wallet-create-disposition.v1";
  disposition: "terminal_no_resource";
  chainId: string;
  controller: string;
  requestSha256: `sha256:${string}`;
  idempotencyKey: string;
};

/** Only call for an authenticated create error without Location. This is
 * identity validation, not a portable receipt or signing authority. */
export function validateCreateDisposition(value: unknown, expected: {
  chainId: number; account: string; bodyBytes: Uint8Array; idempotencyKey: string | null;
}): CreateDisposition | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const keys = ["schemaVersion", "disposition", "chainId", "controller", "requestSha256", "idempotencyKey"];
  if (Object.keys(v).length !== keys.length || !Object.keys(v).every(key => keys.includes(key))
    || v.schemaVersion !== "programmable.wallet-create-disposition.v1" || v.disposition !== "terminal_no_resource"
    || ![1, 4663, 8453, 999].includes(expected.chainId) || v.chainId !== String(expected.chainId)
    || typeof v.controller !== "string" || !/^0x[a-f0-9]{40}$/u.test(v.controller)
    || v.controller !== expected.account.toLowerCase()
    || v.requestSha256 !== `sha256:${createHash("sha256").update(expected.bodyBytes).digest("hex")}`
    || !expected.idempotencyKey || v.idempotencyKey !== expected.idempotencyKey) return;
  return { ...v } as CreateDisposition;
}
