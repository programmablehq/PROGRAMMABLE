import "server-only";

import { PrivyClient } from "@privy-io/node";

// Authentication reads must not inherit the SDK's minute-long timeout and
// automatic retries. Reuse its JWKS cache, but never cache user permissions.
export const PRIVY_READ_TIMEOUT_MS = 5_000;
let configured: { appId: string; secret: string; client: PrivyClient } | undefined;

export function privyReadClient(appId: string, secret: string): PrivyClient {
  if (!configured || configured.appId !== appId || configured.secret !== secret) {
    configured = { appId, secret, client: new PrivyClient({
      appId, appSecret: secret, timeout: PRIVY_READ_TIMEOUT_MS, maxRetries: 0,
    }) };
  }
  return configured.client;
}

type User = Awaited<ReturnType<ReturnType<PrivyClient["users"]>["_get"]>>;
const reads = new WeakMap<PrivyClient, Map<string, Promise<User>>>();

/** Share only overlapping reads. The next request checks current ownership again. */
export function readCurrentPrivyUser(client: PrivyClient, userId: string): Promise<User> {
  let pending = reads.get(client);
  if (!pending) { pending = new Map(); reads.set(client, pending); }
  const active = pending.get(userId);
  if (active) return active;
  const operation = Promise.resolve().then(() => client.users()._get(userId));
  pending.set(userId, operation);
  const clear = () => { if (pending.get(userId) === operation) pending.delete(userId); };
  void operation.then(clear, clear);
  return operation;
}

export function privyReadUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: unknown; name?: unknown };
  return value.status === 429 || typeof value.status === "number" && value.status >= 500
    || ["APIConnectionError", "APIConnectionTimeoutError", "AbortError", "TimeoutError"].includes(String(value.name));
}
