export type ReferenceCase = {
  id: string;
  requirements: string[];
  stages: string[];
  forbiddenActions: string[];
};
export type ProjectObservation = {
  revisionId: string;
  requirements: string[];
  checks: { requirementId: string; revisionId: string; passed: boolean; evidenceId: string }[];
  stages: { stage: string; revisionId: string; passed: boolean; evidenceId: string }[];
  actions: string[];
};
export function evaluateReferenceProject(reference: ReferenceCase, observation: unknown): {
  id: string;
  passed: boolean;
  failures: { code: string; id: string }[];
};
