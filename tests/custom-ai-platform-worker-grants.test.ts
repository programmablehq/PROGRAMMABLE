import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { issueWorkerGrant, verifyWorkerGrant } from "../lib/custom-ai/platform/worker-auth.server";

const keys = generateKeyPairSync("ed25519"), other = generateKeyPairSync("ed25519");
const now = Date.UTC(2026, 10, 7);
const input = { ownerId: "alice", projectId: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222", workerId: "worker-one" };

describe("scoped project worker grants", () => {
  it("binds a worker to one owner, project and run", () => {
    const token = issueWorkerGrant(input, keys.privateKey, now);
    expect(verifyWorkerGrant(token, keys.publicKey, now)).toMatchObject({ ...input, audience: "programmable-project-worker-v1", issuedAt: now, expiresAt: now + 600_000 });
  });
  it("rejects a changed owner even when the token still has a signature", () => {
    const token = issueWorkerGrant(input, keys.privateKey, now), parts = token.split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    parts[1] = Buffer.from(JSON.stringify({ ...claims, ownerId: "bob" })).toString("base64url");
    expect(() => verifyWorkerGrant(parts.join("."), keys.publicKey, now)).toThrow();
  });
  it("rejects expired, premature and foreign-key grants", () => {
    const token = issueWorkerGrant(input, keys.privateKey, now);
    expect(() => verifyWorkerGrant(token, keys.publicKey, now + 600_001)).toThrow();
    expect(() => verifyWorkerGrant(token, keys.publicKey, now - 60_000)).toThrow();
    expect(() => verifyWorkerGrant(token, other.publicKey, now)).toThrow();
  });
  it("rejects unknown authority-bearing fields even with a valid signature", () => {
    const valid = verifyWorkerGrant(issueWorkerGrant(input, keys.privateKey, now), keys.publicKey, now);
    const body = Buffer.from(JSON.stringify({ ...valid, admin: true })).toString("base64url");
    const message = `v1.${body}`;
    const forged = `${message}.${sign(null, Buffer.from(message), keys.privateKey).toString("base64url")}`;
    expect(() => verifyWorkerGrant(forged, keys.publicKey, now)).toThrow();
  });
  it("rejects malformed and oversized credentials without decoding unbounded data", () => {
    for (const token of ["", "v1.x.y", "a".repeat(5000)]) expect(() => verifyWorkerGrant(token, keys.publicKey, now)).toThrow();
    expect(() => issueWorkerGrant({ ...input, projectId: "not-a-project" }, keys.privateKey, now)).toThrow();
  });
});
