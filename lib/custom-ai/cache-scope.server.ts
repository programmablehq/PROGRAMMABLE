import "server-only";
import { createHash } from "node:crypto";

/** An opaque cache namespace, never a credential or substitute for auth. */
export function customAICacheScope(owner: string) {
  return createHash("sha256").update(JSON.stringify(["programmable.custom-ai-cache.v2", owner])).digest("hex");
}
