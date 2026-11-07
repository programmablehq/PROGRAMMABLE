/** Canonical dependency-free wire contract. Generate clients with
 * scripts/custom-ai/build-platform-protocol.mjs; do not fork this per service. */
export const PROJECT_PROTOCOL_VERSION = "1.0.0" as const;

export type ProjectScope = { ownerId: string; projectId: string };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ProjectRequirement = {
  id: string;
  text: string;
  kind: "behavior" | "constraint" | "decision";
  open: string | null;
  origin: { kind: "message"; requestId: string; messageIndex: number; quote: string }
    | { kind: "legacy"; requestId?: string; sourceHash?: string };
};
export type ProjectFile = string | { encoding: "base64"; content: string; mediaType: string };
export type ProjectFileChange = { operation: "write"; path: string; beforeHash: string | null; content: ProjectFile }
  | { operation: "delete"; path: string; beforeHash: string };
export type ProjectDocument = {
  title: string;
  requirements: ProjectRequirement[];
  files: Record<string, ProjectFile>;
  dependencies: Record<string, string>;
  architecture: JsonValue;
};
export type ProjectRevision = ProjectScope & {
  revisionId: string;
  parentRevisionId: string | null;
  ordinal: number;
  requirementsHash: string;
  fileTreeHash: string;
  dependencyLockHash: string;
  architectureHash: string;
  createdAt: string;
  document: ProjectDocument;
};
export type ProjectPatch = Partial<ProjectDocument> & { removeRequirementIds?: string[]; removeFilePaths?: string[]; fileChanges?: ProjectFileChange[] };
export type RevisionPatchInput = ProjectScope & {
  expectedRevisionId: string;
  idempotencyKey: string;
  patch: ProjectPatch;
};

export type RunStatus = "queued" | "running" | "waiting_user" | "retryable" | "failed" | "cancelled" | "succeeded";
export type EvidenceRef = { id: string; artifactHash: string; kind: string };
export type ToolGrant = ProjectScope & {
  revisionId: string;
  capabilityId: string;
  capabilityVersion: string;
  actions: string[];
  resourceIds: string[];
  expiresAt: string;
  budgetReservationId: string;
};
export type ToolCall = { runId: string; stepId: string; grant: ToolGrant; input: JsonValue; idempotencyKey: string };
export type RunSnapshot = ProjectScope & { revisionId: string; runId: string; status: RunStatus; cursor: string; evidence: EvidenceRef[] };
export type StartRunInput = ProjectScope & { revisionId: string; operation: string; idempotencyKey: string; budgetReservationId: string };
export type SecretRef = { connectionId: string; keyId: string; version: string };
export type ConnectionManifest = { id: string; version: string; schemaHash: string; actions: string[]; endpointPolicyId: string };
export type ReleaseInput = ProjectScope & { revisionId: string; artifactHashes: string[]; evidenceIds: string[]; targetId: string; configHash: string; idempotencyKey: string };
export type WorkerGrantClaims = ProjectScope & {
  audience: "programmable-project-worker-v1";
  runId: string;
  workerId: string;
  issuedAt: number;
  expiresAt: number;
  protocolHash: string;
};
