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
import type { AutomaticSourceReceipt } from "../lib/custom-ai/automatic-source.server";

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
  it("binds automatic source and check commands to the current request without exposing a wallet permit",async()=>{
    const req=request(),authority=await authorizeCustomAI(req),hash=`sha256:${"1".repeat(64)}` as const;
    const receipt:AutomaticSourceReceipt={schemaVersion:"programmable.automatic-source-context.v1",reviewId:id,subjectHash:hash,chainId:"8453",controller:wallet,
      sourceGeneratedAt:now.getTime()-90_000,artifactHash:hash,intentHash:hash,productionHash:hash,verifierRevision:hash,
      intent:{version:1,id:"gqa",revision:"a".repeat(64),requirements:[],changes:[],unresolved:[]},compilationUnits:[{id:"gqa",inputHash:hash}]};
    const f=bridge(vi.fn().mockResolvedValue(reply({schemaVersion:"programmable.automatic-source-bound.v1",reviewId:id,bound:true},200)));
    await f.service.automaticReview(req,authority,{account:wallet,reviewId:id,operation:"bind-source",receipt});
    const [url,init]=f.fetchBackend.mock.calls[0] as [URL,RequestInit];
    expect(url.pathname).toBe(`/v1/wallet-admin/custom-ai/launch-reviews/${id}/source-context`);
    const bytes=Buffer.from(init.body as Uint8Array),headers=new Headers(init.headers);
    expect(JSON.parse(bytes.toString())).toEqual({receipt});expect(init.method).toBe("POST");expect(init.redirect).toBe("error");
    const bodySha=`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const expected=createHmac("sha256",assertionKey).update("programmable.custom-launch-api.wallet-bff-assertion.v2\0")
      .update(["POST",url.pathname,subject,wallet,now.toISOString(),nonce,bodySha].join("\0")).digest("hex");
    expect(headers.get("x-programmable-bff-assertion-signature")).toBe(`hmac-sha256:${expected}`);
    const checking={schemaVersion:"programmable.automatic-launch-status.v1",reviewId:id,state:"checking",manualReviewRequired:false,launchReady:false,findings:[],timing:null};
    const g=bridge(vi.fn().mockResolvedValue(reply(checking,202)));
    expect((await g.service.automaticReview(req,authority,{account:wallet,reviewId:id,operation:"check"})).value).toEqual(checking);
    expect(Buffer.from(g.fetchBackend.mock.calls[0][1].body).toString()).toBe('{"action":"check"}');
  });
  it("automatic status reads never send a check command and cannot use a copied owner or false ready reply",async()=>{
    const req=new Request("https://site.test/api/custom-ai/general-launch"),authority=await authorizeCustomAI(req);
    const status={schemaVersion:"programmable.automatic-launch-status.v1",reviewId:id,state:"approved",manualReviewRequired:false,launchReady:false};
    const f=bridge(vi.fn().mockResolvedValue(reply(status,200)));
    await f.service.automaticReview(req,authority,{account:wallet,reviewId:id,operation:"status"});
    const [,init]=f.fetchBackend.mock.calls[0] as [URL,RequestInit];expect(init.method).toBe("GET");expect(init.body).toBeUndefined();
    const bad=bridge(vi.fn().mockResolvedValue(reply({...status,launchReady:true},200)));
    await expect(bad.service.automaticReview(req,authority,{account:wallet,reviewId:id,operation:"status"})).rejects.toMatchObject({code:"launch-transport"});
    const unused=bridge();
    await expect(unused.service.automaticReview(req,{...authority} as AIAuthority,{account:wallet,reviewId:id,operation:"status"})).rejects.toMatchObject({code:"session_changed"});
    await expect(unused.service.automaticReview(req,authority,{account:other,reviewId:id,operation:"status"})).rejects.toMatchObject({code:"wallet"});
    expect(unused.fetchBackend).not.toHaveBeenCalled();
  });
  it.each([1,4663,8453,999] as const)("reads only one small V2-signed status response on %s",async chainId=>{
    const req=new Request("https://site.test/api/custom-ai/general-launch?id=saved-ticket-0001&view=status"),authority=await authorizeCustomAI(req);
    const f=bridge(vi.fn().mockResolvedValue(reply({schemaVersion:"programmable.wallet-launch-status.v1"},200)));
    const value=await f.service.status(req,authority,{chainId,account:wallet,resourceId:id});
    expect(f.fetchBackend).toHaveBeenCalledOnce();const [url,init]=f.fetchBackend.mock.calls[0] as [URL,RequestInit];
    expect(url.pathname+url.search).toBe(`${walletLaunchMutationTargetV1(chainId,"create")}/${id}?view=status`);
    expect(init.method).toBe("GET");expect(init.body).toBeUndefined();expect(init.redirect).toBe("error");
    const headers=new Headers(init.headers),bodySha=`sha256:${createHash("sha256").update("").digest("hex")}`;
    const fields=["GET",url.pathname+url.search,subject,wallet,now.toISOString(),nonce,bodySha];
    const signature=createHmac("sha256",assertionKey).update(Buffer.concat([Buffer.from("programmable.custom-launch-api.wallet-bff-assertion.v2"),Buffer.from([0]),Buffer.from(fields.join("\0"))])).digest("hex");
    expect(headers.get("x-programmable-bff-assertion-version")).toBe("2");expect(headers.get("x-programmable-bff-assertion-signature")).toBe(`hmac-sha256:${signature}`);
    expect(headers.get("idempotency-key")).toBeNull();expect(headers.get("programmable-launch-response-version")).toBeNull();
    expect(value.httpStatus).toBe(200);expect(mock.authenticate).toHaveBeenCalledOnce();
  });
  it("does not follow status redirects, retry errors, load a large source reply or accept a copied authority",async()=>{
    const req=new Request("https://site.test/api/custom-ai/general-launch"),authority=await authorizeCustomAI(req);
    for(const response of [reply({},302,{location:"https://elsewhere.test"}),reply({},503),reply({source:"x".repeat(5000)},200)]){
      const f=bridge(vi.fn().mockResolvedValue(response));await expect(f.service.status(req,authority,{chainId:1,account:wallet,resourceId:id})).rejects.toMatchObject({status:503});
      expect(f.fetchBackend).toHaveBeenCalledOnce();
    }
    const f=bridge();await expect(f.service.status(req,{...authority} as AIAuthority,{chainId:1,account:wallet,resourceId:id})).rejects.toMatchObject({code:"session_changed"});
    await expect(f.service.status(req,authority,{chainId:1,account:other,resourceId:id})).rejects.toMatchObject({status:403});expect(f.fetchBackend).not.toHaveBeenCalled();
  });
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
