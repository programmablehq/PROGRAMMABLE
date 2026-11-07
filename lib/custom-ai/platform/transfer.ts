import { ProjectError, type ProjectDocument, type ProjectRevision } from "./types";
import { projectHash, validateDocument } from "./document";
import { assertExportableFiles, assertExportableMetadata } from "./files";

export type ProjectBundle = { format: "programmable-project"; version: 1; projectId: string; revisionId: string; documentHash: string; document: ProjectDocument };
export function exportProjectBundle(revision: ProjectRevision): ProjectBundle {
  validateDocument(revision.document);
  assertExportableFiles(revision.document.files);
  assertExportableMetadata(revision.document);
  return { format: "programmable-project", version: 1, projectId: revision.projectId, revisionId: revision.revisionId,
    documentHash: projectHash(revision.document), document: structuredClone(revision.document) };
}
export function readProjectBundle(value: unknown): ProjectDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectError("project-import", "Use a complete project export.");
  const bundle = value as ProjectBundle;
  if (Object.keys(bundle).sort().join() !== "document,documentHash,format,projectId,revisionId,version"
    || bundle.format !== "programmable-project" || bundle.version !== 1
    || typeof bundle.projectId !== "string" || typeof bundle.revisionId !== "string") throw new ProjectError("project-import", "Use a complete project export.");
  validateDocument(bundle.document);
  if (bundle.documentHash !== projectHash(bundle.document)) throw new ProjectError("project-import", "The project export does not match its content hash.", 409);
  assertExportableFiles(bundle.document.files);
  assertExportableMetadata(bundle.document);
  return structuredClone(bundle.document);
}
