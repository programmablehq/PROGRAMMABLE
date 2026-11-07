import "server-only";
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { ProjectError, type ProjectScope } from "./types";
import { validateScope } from "./document";
import { PROJECT_PROTOCOL_HASH, type WorkerGrantClaims } from "./protocol.generated";

const denied = () => new ProjectError("worker-grant", "Invalid project worker authorization.", 403);
const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function checked(value: unknown, now: number): WorkerGrantClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join() !== "audience,expiresAt,issuedAt,ownerId,projectId,protocolHash,runId,workerId") throw denied();
  const claims = value as WorkerGrantClaims;
  try { validateScope(claims); } catch { throw denied(); }
  if (claims.audience !== "programmable-project-worker-v1" || !validId(claims.runId)
    || typeof claims.workerId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(claims.workerId)
    || claims.protocolHash !== PROJECT_PROTOCOL_HASH || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)
    || claims.issuedAt > now + 5000 || claims.expiresAt <= now || claims.expiresAt <= claims.issuedAt || claims.expiresAt - claims.issuedAt > 600_000) throw denied();
  return Object.freeze({ ...claims });
}

export function issueWorkerGrant(input: ProjectScope & { runId: string; workerId: string }, key: KeyObject | string, now = Date.now()): string {
  const claims = checked({ ...input, audience: "programmable-project-worker-v1", issuedAt: now, expiresAt: now + 600_000, protocolHash: PROJECT_PROTOCOL_HASH }, now);
  const signer = typeof key === "string" ? createPrivateKey(key) : key;
  if (signer.type !== "private" || signer.asymmetricKeyType !== "ed25519") throw new ProjectError("worker-configuration", "The worker signing key is not configured.", 503);
  const content = `v1.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${content}.${sign(null, Buffer.from(content), signer).toString("base64url")}`;
}

export function verifyWorkerGrant(token: string, key: KeyObject | string, now = Date.now()): WorkerGrantClaims {
  if (typeof token !== "string" || token.length > 3000) throw denied();
  const pieces = token.split(".");
  if (pieces.length !== 3 || pieces[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(pieces[1]) || !/^[A-Za-z0-9_-]+$/.test(pieces[2])) throw denied();
  try {
    const signature = Buffer.from(pieces[2], "base64url"), body = Buffer.from(pieces[1], "base64url");
    const verifier = typeof key === "string" ? createPublicKey(key) : key;
    if (signature.length !== 64 || body.toString("base64url") !== pieces[1] || verifier.type !== "public" || verifier.asymmetricKeyType !== "ed25519"
      || !verify(null, Buffer.from(`${pieces[0]}.${pieces[1]}`), verifier, signature)) throw denied();
    return checked(JSON.parse(body.toString("utf8")), now);
  } catch { throw denied(); }
}
