export type { ProjectScope, JsonValue, ProjectDocument, ProjectRevision, ProjectPatch, RevisionPatchInput, ProjectFile, ProjectFileChange } from "./protocol.generated";

export class ProjectError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "ProjectError";
  }
}
