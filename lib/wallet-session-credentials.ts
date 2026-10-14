type Session = Readonly<{ userId: string | null; active: boolean; revision: number }>;
type Sources = Readonly<{
  session: () => Session;
  accessToken: () => Promise<string | null>;
  identityToken: () => Promise<string | null>;
  cachedIdentityToken: () => string | null;
}>;

function currentIdentityToken(token: string | null, userId: string): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(atob(payload.replace(/-/gu, "+").replace(/_/gu, "/"))) as { sub?: unknown; exp?: unknown };
    // This is only a freshness filter. The backend still verifies the signature,
    // audience and exact access/identity session binding for every request.
    return claims.sub === userId && typeof claims.exp === "number" && claims.exp * 1000 > Date.now() + 30_000 ? token : null;
  } catch { return null; }
}

/** Stable callbacks, one pending SDK read per credential, no cross-account result. */
export function createWalletSessionCredentials(initialSources?: Sources, timeoutMs = 8_000) {
  let sources = initialSources ?? { session: () => ({ userId: null, active: false, revision: 0 }),
    accessToken: async () => null, identityToken: async () => null, cachedIdentityToken: () => null };
  const pending = new Map<string, Promise<string | null>>();
  const matches = (before: Session) => {
    const after = sources.session();
    return before.active && after.active && before.userId !== null
      && before.userId === after.userId && before.revision === after.revision;
  };
  const read = (kind: "access" | "identity") => {
    const before = sources.session();
    if (!before.active || !before.userId) return Promise.resolve(null);
    const key = `${kind}:${before.userId}:${before.revision}`;
    const current = pending.get(key);
    if (current) return current;
    let timer: ReturnType<typeof setTimeout>;
    const operation = Promise.race([
      Promise.resolve().then(() => kind === "access" ? sources.accessToken()
        : currentIdentityToken(sources.cachedIdentityToken(), before.userId!) ?? sources.identityToken()),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(
        new Error("Wallet access is temporarily unavailable. Please try again.")), timeoutMs); }),
    ]).then(token => matches(before) ? kind === "identity" ? currentIdentityToken(token, before.userId!) : token : null).finally(() => {
      clearTimeout(timer);
      if (pending.get(key) === operation) pending.delete(key);
    });
    pending.set(key, operation);
    return operation;
  };
  return Object.freeze({ setSources: (next: Sources) => { sources = next; },
    getAccessToken: () => read("access"), getIdentityToken: () => read("identity") });
}
