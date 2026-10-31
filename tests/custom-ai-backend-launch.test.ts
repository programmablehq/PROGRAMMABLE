import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("../lib/server/creator-article/wallet-principal.server", () => ({
  createPrivyWalletPrincipalAuthenticatorV1: () => ({ authenticate: mock.authenticate }),
  WalletPrincipalAuthenticationErrorV1: class extends Error {},
}));
import { authorizeCustomAI, requireFreshCustomAIAuthority, type AIAuthority } from "../lib/custom-ai/auth.server";
import { createCustomAIBackendLaunchBridge } from "../lib/custom-ai/backend-launch.server";
import { createWalletLaunchBffAssertionV1, walletLaunchMutationTargetV1 } from "../lib/server/custom-launch/wallet-launch-bff-assertion-v1";

const wallet = `0x${"11".repeat(20)}` as const, other = `0x${"22".repeat(20)}` as const;
const subject = "did:privy:fresh-owner", websiteToken = "w".repeat(43), assertionKey = "k".repeat(43);
const now = new Date("2026-10-31T18:00:00.000Z"), nonce = Buffer.alloc(16, 7).toString("base64url");
const bodyBytes = Buffer.from('{"chainId":"8453","source":"owned exact source"}');
const idempotencyKey = "owned-general-launch-0001", id = "20000000-0000-4000-8000-000000000001";
const request = () => new Request("https://site.test/api/custom-ai/general-launch", { method: "POST", headers: { origin: "https://site.test" } });
const candidate = { chainId: 8453 as const, operation: "create" as const, account: wallet, bodyBytes, idempotencyKey };
const reply = (value: unknown = { status: "received" }, status = 202, headers: Record<string, string> = {}) => Response.json(value, { status, headers });
const bridge = (fetchBackend = vi.fn().mockResolvedValue(reply()), maximumReplyBytes?: number) => ({
  fetchBackend,
  service: createCustomAIBackendLaunchBridge({ backendBaseUrl: "https://api.test/", websiteToken, assertionKey, fetchBackend,
    now: () => now, nonce: () => nonce, ...(maximumReplyBytes === undefined ? {} : { maximumReplyBytes }) }),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED", "true");
  vi.spyOn(Date, "now").mockReturnValue(now.getTime());
  mock.authenticate.mockResolvedValue({ privyUserId: subject, privySessionId: "current-session", wallets: [wallet] });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("body-bound session launch producer", () => {
  it("matches the independent backend domain and all eight fixed mutation routes", () => {
    for (const [chainId, create, preflight] of [
      [1, "/v3/wallet-admin/custom-launches", "/v3/wallet-admin/custom-launches/preflight"],
      [4663, "/v4/chains/4663/wallet-admin/custom-launch-plans", "/v4/chains/4663/wallet-admin/custom-launch-plans:preflight"],
      [8453, "/v4/chains/8453/wallet-admin/custom-launches", "/v4/chains/8453/wallet-admin/custom-launches/preflight"],
      [999, "/v4/chains/999/wallet-admin/custom-launches", "/v4/chains/999/wallet-admin/custom-launches/preflight"],
    ] as const) {
      for (const [operation, target] of [["create", create], ["preflight", preflight]] as const) {
        expect(walletLaunchMutationTargetV1(chainId, operation)).toBe(target);
        const key = operation === "create" ? idempotencyKey : null, version = chainId === 4663 ? "1.2" : null;
        const fields = createWalletLaunchBffAssertionV1({ chainId, operation, privyUserId: subject, walletAddress: wallet,
          issuedAt: now.toISOString(), nonce, bodyBytes, idempotencyKey: key, responseVersion: version, assertionKey });
        const digest = `sha256:${createHash("sha256").update(bodyBytes).digest("hex")}`;
        const expected = createHmac("sha256", assertionKey).update([
          "programmable.custom-launch-api.wallet-launch-assertion.v1", "3", "POST", target,
          subject, wallet, now.toISOString(), nonce, digest, key ?? "", version ?? "",
        ].join("\n")).digest("hex");
        expect(fields["X-Programmable-Bff-Assertion-Signature"]).toBe(`hmac-sha256:${expected}`);
        expect(fields["X-Programmable-Bff-Assertion-Version"]).toBe("3");
      }
    }
  });

  it("uses the current request owner and selected linked wallet with one authentication and one exact POST", async () => {
    const current = request(), authority = await authorizeCustomAI(current), f = bridge();
    const result = await f.service.submit(current, authority, candidate);
    expect(mock.authenticate).toHaveBeenCalledTimes(1); expect(f.fetchBackend).toHaveBeenCalledTimes(1);
    const [target, init] = f.fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(target.href).toBe("https://api.test/v4/chains/8453/wallet-admin/custom-launches");
    expect(Buffer.from(init.body as Uint8Array)).toEqual(bodyBytes);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    const headers = new Headers(init.headers);
    expect(headers.get("x-programmable-privy-user-id")).toBe(subject);
    expect(headers.get("x-programmable-wallet-address")).toBe(wallet);
    expect(headers.get("idempotency-key")).toBe(idempotencyKey);
    expect(headers.get("programmable-launch-response-version")).toBeNull();
    expect(result).toEqual({ httpStatus: 202, value: { status: "received" }, location: null });
    expect(result).not.toHaveProperty("launchReady");
  });

  it("rejects saved-owner objects, copied authorities, another request, expiry and an unlinked wallet before any backend call", async () => {
    const current = request(), authority = await authorizeCustomAI(current), f = bridge();
    const saved = { kind: "account", owner: subject, principal: { privyUserId: subject, privySessionId: "saved", wallets: [wallet] } } as AIAuthority;
    for (const [req, value] of [[current, saved], [current, { ...authority }], [request(), authority]] as const)
      await expect(f.service.submit(req, value, candidate)).rejects.toMatchObject({ code: "session_changed", status: 409 });
    await expect(f.service.submit(current, authority, { ...candidate, account: other })).rejects.toMatchObject({ code: "wallet", status: 403 });
    vi.mocked(Date.now).mockReturnValue(now.getTime() + 120_000);
    await expect(f.service.submit(current, authority, candidate)).rejects.toMatchObject({ code: "session_changed", status: 409 });
    expect(f.fetchBackend).not.toHaveBeenCalled();
  });

  it("keeps the verified wallet snapshot immutable and denies aborted or implicit GET submissions", async () => {
    const current = request(), authority = await authorizeCustomAI(current);
    expect(Object.isFrozen(authority)).toBe(true);
    if (authority.kind === "account") { expect(Object.isFrozen(authority.principal)).toBe(true); expect(Object.isFrozen(authority.principal.wallets)).toBe(true); }
    const signal = new AbortController(), stopped = new Request(current, { signal: signal.signal });
    const stoppedAuthority = await authorizeCustomAI(stopped); signal.abort();
    expect(() => requireFreshCustomAIAuthority(stopped, stoppedAuthority)).toThrow();
    const f = bridge(), get = new Request(current.url), readAuthority = await authorizeCustomAI(get);
    await expect(f.service.submit(get, readAuthority, candidate)).rejects.toMatchObject({ status: 405 });
    expect(f.fetchBackend).not.toHaveBeenCalled();
  });

  it("binds Robinhood response negotiation and preflight without inventing a key or a create idempotency header", async () => {
    const current = request(), authority = await authorizeCustomAI(current), f = bridge();
    await f.service.submit(current, authority, { ...candidate, chainId: 4663, operation: "preflight", idempotencyKey: null });
    const [target, init] = f.fetchBackend.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(target.pathname).toBe("/v4/chains/4663/wallet-admin/custom-launch-plans:preflight");
    expect(headers.get("programmable-launch-response-version")).toBe("1.2");
    expect(headers.get("idempotency-key")).toBeNull();
    expect(headers.get("authorization")).toBe(`Bearer ${websiteToken}`);
    expect(headers.get("authorization")).not.toContain("pm_live_");
  });

  it("retains one explicit attempt on rejection, malformed JSON, transport failure or a foreign redirect/location", async () => {
    const current = request(), authority = await authorizeCustomAI(current);
    const factories = [
      () => reply({ error: { code: "PROFILE_INVALID" } }, 422),
      () => new Response("invalid", { headers: { "content-type": "application/json" } }),
      () => Response.redirect("https://foreign.test/", 302),
      () => reply({}, 202, { location: `https://foreign.test/v4/chains/8453/wallet-admin/custom-launches/${id}` }),
    ];
    for (const response of factories) {
      const f = bridge(vi.fn().mockImplementation(async () => response()));
      await expect(f.service.submit(current, authority, candidate)).rejects.toHaveProperty("status");
      expect(f.fetchBackend).toHaveBeenCalledTimes(1);
    }
    const f = bridge(vi.fn().mockRejectedValue(new Error("local network fixture")));
    await expect(f.service.submit(current, authority, candidate)).rejects.toMatchObject({ code: "launch-transport", status: 503 });
    expect(f.fetchBackend).toHaveBeenCalledTimes(1);
  });

  it("bounds streamed and declared replies, cancels unread bodies, and accepts only a same-chain resource location", async () => {
    const current = request(), authority = await authorizeCustomAI(current), cancelled = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65)); }, cancel: cancelled }),
      { headers: { "content-type": "application/json" } });
    const f = bridge(vi.fn().mockResolvedValue(response), 64);
    await expect(f.service.submit(current, authority, candidate)).rejects.toMatchObject({ code: "launch-transport" });
    expect(cancelled).toHaveBeenCalledTimes(1);
    const declared = bridge(vi.fn().mockResolvedValue(reply({}, 202, { "content-length": "65" })), 64);
    await expect(declared.service.submit(current, authority, candidate)).rejects.toMatchObject({ code: "launch-transport" });
    const success = bridge(vi.fn().mockResolvedValue(reply({}, 202, { location: `/v4/chains/8453/wallet-admin/custom-launches/${id}` })));
    expect((await success.service.submit(current, authority, candidate)).location).toBe(`/v4/chains/8453/wallet-admin/custom-launches/${id}`);
    const otherChain = bridge(vi.fn().mockResolvedValue(reply({}, 202, { location: `/v4/chains/999/wallet-admin/custom-launches/${id}` })));
    await expect(otherChain.service.submit(current, authority, candidate)).rejects.toMatchObject({ code: "launch-transport" });
  });

  it("fails invalid secret/origin/operation framing before using any backend", () => {
    expect(() => createCustomAIBackendLaunchBridge({ backendBaseUrl: "https://api.test/", websiteToken, assertionKey: websiteToken, fetchBackend: vi.fn() })).toThrow();
    expect(() => createCustomAIBackendLaunchBridge({ backendBaseUrl: "https://user:password@api.test/", websiteToken, assertionKey, fetchBackend: vi.fn() })).toThrow();
    const input = { chainId: 8453 as const, operation: "create" as const, privyUserId: subject, walletAddress: wallet,
      issuedAt: now.toISOString(), nonce, bodyBytes, idempotencyKey, responseVersion: null, assertionKey };
    expect(() => createWalletLaunchBffAssertionV1({ ...input, privyUserId: "did:privy:injected\nfield" })).toThrow();
    expect(() => createWalletLaunchBffAssertionV1({ ...input, responseVersion: "1.2" })).toThrow();
    expect(() => createWalletLaunchBffAssertionV1({ ...input, operation: "preflight" })).toThrow();
  });
});
