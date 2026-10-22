import { describe, expect, it, vi } from "vitest";
import { createWalletSessionCredentials } from "../lib/wallet-session-credentials";

describe("shared wallet credentials", () => {
  const token = (sub: string, exp = Date.now() / 1000 + 3600) => `header.${btoa(JSON.stringify({ sub, exp }))}.signature`;
  it("coalesces concurrent SDK reads and reads again after completion", async () => {
    let finish!: (value: string) => void;
    const accessToken = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const credentials = createWalletSessionCredentials({
      session: () => ({ userId: "alice", active: true, revision: 1 }), accessToken,
      identityToken: async () => null, cachedIdentityToken: () => null,
    });
    const one = credentials.getAccessToken(), two = credentials.getAccessToken();
    expect(one).toBe(two);
    await Promise.resolve();
    expect(accessToken).toHaveBeenCalledTimes(1);
    finish("token");
    expect(await one).toBe("token");
    accessToken.mockResolvedValueOnce("fresh");
    expect(await credentials.getAccessToken()).toBe("fresh");
  });

  it("discards a pending token after logout, account change or return to the same account", async () => {
    let revision = 1;
    let finish!: (value: string) => void;
    const credentials = createWalletSessionCredentials({
      session: () => ({ userId: "alice", active: true, revision }),
      accessToken: () => new Promise<string>(resolve => { finish = resolve; }),
      identityToken: async () => null, cachedIdentityToken: () => null,
    });
    const pending = credentials.getAccessToken();
    await Promise.resolve();
    revision += 2;
    finish("obsolete");
    expect(await pending).toBeNull();
  });

  it("uses the current identity token without an unnecessary user refresh", async () => {
    const cached = token("alice");
    const identityToken = vi.fn(async () => token("alice"));
    const credentials = createWalletSessionCredentials({
      session: () => ({ userId: "alice", active: true, revision: 1 }),
      accessToken: async () => "access", identityToken, cachedIdentityToken: () => cached,
    });
    expect(await credentials.getIdentityToken()).toBe(cached);
    expect(identityToken).not.toHaveBeenCalled();
  });

  it("refreshes expired identity tokens and never forwards another user's cached identity", async () => {
    const fresh = token("alice");
    for (const stale of [token("alice", 1), token("bob")]) {
      const identityToken = vi.fn(async () => fresh);
      const credentials = createWalletSessionCredentials({
        session: () => ({ userId: "alice", active: true, revision: 1 }),
        accessToken: async () => "access", identityToken, cachedIdentityToken: () => stale,
      });
      expect(await credentials.getIdentityToken()).toBe(fresh);
      expect(identityToken).toHaveBeenCalledOnce();
    }
  });

  it("releases an unresponsive read so retry is possible", async () => {
    vi.useFakeTimers();
    try {
      const accessToken = vi.fn<() => Promise<string | null>>().mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue("recovered");
      const credentials = createWalletSessionCredentials({
        session: () => ({ userId: "alice", active: true, revision: 1 }), accessToken,
        identityToken: async () => null, cachedIdentityToken: () => null,
      }, 100);
      const rejected = expect(credentials.getAccessToken()).rejects.toThrow("temporarily unavailable");
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(await credentials.getAccessToken()).toBe("recovered");
    } finally { vi.useRealTimers(); }
  });

  it("does not refresh an optional missing identity token on every request", async () => {
    vi.useFakeTimers();
    try {
      const identityToken = vi.fn(async () => null);
      let revision = 1;
      const credentials = createWalletSessionCredentials({
        session: () => ({ userId: "alice", active: true, revision }),
        accessToken: async () => "access", identityToken, cachedIdentityToken: () => null,
      });
      for (let index = 0; index < 20; index++) expect(await credentials.getIdentityToken()).toBeNull();
      expect(identityToken).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(60_001);
      await credentials.getIdentityToken();
      expect(identityToken).toHaveBeenCalledTimes(2);
      revision++;
      await credentials.getIdentityToken();
      expect(identityToken).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it("uses a refreshed identity while the hook catches up, but rechecks expiry and the session", async () => {
    vi.useFakeTimers();
    try {
      const fresh = token("alice", Date.now() / 1000 + 45);
      const next = token("alice");
      const identityToken = vi.fn().mockResolvedValueOnce(fresh).mockResolvedValue(next);
      let active = true;
      const credentials = createWalletSessionCredentials({
        session: () => ({ userId: "alice", active, revision: 1 }),
        accessToken: async () => "access", identityToken, cachedIdentityToken: () => null,
      });
      expect(await credentials.getIdentityToken()).toBe(fresh);
      expect(await credentials.getIdentityToken()).toBe(fresh);
      expect(identityToken).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(16_000);
      expect(await credentials.getIdentityToken()).toBe(next);
      active = false;
      expect(await credentials.getIdentityToken()).toBeNull();
      active = true;
      expect(await credentials.getIdentityToken()).toBe(next);
      expect(identityToken).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it("does not treat failed refreshes as an absent identity token", async () => {
    const identityToken = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 }))
      .mockResolvedValue(token("alice"));
    const credentials = createWalletSessionCredentials({
      session: () => ({ userId: "alice", active: true, revision: 1 }),
      accessToken: async () => "access", identityToken, cachedIdentityToken: () => null,
    });
    await expect(credentials.getIdentityToken()).rejects.toThrow("Rate limited");
    expect(await credentials.getIdentityToken()).not.toBeNull();
    expect(identityToken).toHaveBeenCalledTimes(2);
  });

  it("discards even a cached identity if the session changes before it is delivered", async () => {
    let revision = 1;
    const credentials = createWalletSessionCredentials({
      session: () => ({ userId: "alice", active: true, revision }),
      accessToken: async () => "access", identityToken: async () => null,
      cachedIdentityToken: () => token("alice"),
    });
    const result = credentials.getIdentityToken();
    revision++;
    expect(await result).toBeNull();
  });
});
