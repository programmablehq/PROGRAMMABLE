import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { construct, readUser } = vi.hoisted(() => ({ construct: vi.fn(), readUser: vi.fn() }));
vi.mock("@privy-io/node", () => ({ PrivyClient: class {
  constructor(options: unknown) { construct(options); }
  users() { return { _get: readUser }; }
} }));
import { privyReadClient, readCurrentPrivyUser, privyReadUnavailable } from "../lib/server/privy-read-client";

describe("bounded Privy authentication reads", () => {
  beforeEach(() => { construct.mockClear(); readUser.mockReset(); });
  it("reuses one client and JWKS cache without minute-long retries", () => {
    const client = privyReadClient("app", "secret");
    expect(privyReadClient("app", "secret")).toBe(client);
    expect(construct).toHaveBeenCalledWith({ appId: "app", appSecret: "secret", timeout: 5000, maxRetries: 0 });
    expect(privyReadClient("app", "rotated")).not.toBe(client);
  });
  it("shares only overlapping reads, keeping different users and later permissions separate", async () => {
    const client = privyReadClient("app-2", "secret");
    let finish!: (value: unknown) => void;
    readUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ id: "bob" });
    const alice = readCurrentPrivyUser(client, "alice");
    expect(readCurrentPrivyUser(client, "alice")).toBe(alice);
    expect(await readCurrentPrivyUser(client, "bob")).toEqual({ id: "bob" });
    finish({ id: "alice" });
    await alice;
    readUser.mockResolvedValue({ id: "alice", linked_accounts: [] });
    expect(await readCurrentPrivyUser(client, "alice")).toEqual({ id: "alice", linked_accounts: [] });
    expect(readUser).toHaveBeenCalledTimes(3);
  });
  it("does not classify a bad credential as a provider outage", () => {
    expect(privyReadUnavailable({ status: 401 })).toBe(false);
    expect(privyReadUnavailable({ status: 429 })).toBe(true);
    expect(privyReadUnavailable({ status: 503 })).toBe(true);
    expect(privyReadUnavailable({ name: "APIConnectionTimeoutError" })).toBe(true);
  });
});
