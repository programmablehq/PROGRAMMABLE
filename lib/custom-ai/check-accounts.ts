/** Deterministic local EVM actors. Signing actors are public test identities,
 * never connected wallets or permission to sign outside the isolated worker. */
export const CHECK_SIGNERS = ["signer-issuer", "signer-player-a", "signer-player-b"] as const;
export const CHECK_ACCOUNTS = ["creator", "trader-a", "trader-b", ...CHECK_SIGNERS] as const;
export type CheckAccount = typeof CHECK_ACCOUNTS[number];
export type CheckSigner = typeof CHECK_SIGNERS[number];
