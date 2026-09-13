// Additive protected review identity. It does not replace the historical shared-hook environment.
export const MODULE_ENGINE_POSITION_MANAGER_ENVIRONMENT_V1 = Object.freeze({
  profile: "robinhood-any-quote.position-manager.v1",
  // Exact nine-file backend-owned execution environment; activation remains separate.
  sourceDigest: "0xc09fe0a0f5c9d816f9cbb7104ab5f9f3d76edaa9e5bf66cd36bc3b5234f0839d",
} as const);

export const MODULE_ENGINE_POSITION_MANAGER_CHECKS_V1 = Object.freeze([
  "canonicalPeriphery", "positionCustody", "exactSettlementAndAllowances",
] as const);

export const MODULE_ENGINE_POSITION_MANAGER_REVIEW_AREAS_V1 = Object.freeze([
  "canonical-position-manager-custody-and-no-principal-exit",
] as const);
