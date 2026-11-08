import { createHash } from "node:crypto";
import { ProjectError, type ProjectFile, type ProjectFileChange } from "./types";
import {containsInlineCredential} from "./secret-input";

const invalid = () => new ProjectError("project-input", "Use valid project files and paths.");
export function projectFilePath(path: unknown): string {
  if (typeof path !== "string" || !path || path.length > 512 || path !== path.normalize("NFC")
    || path.startsWith("/") || /[\\:\u0000-\u001f\u007f]/u.test(path)) throw invalid();
  const parts = path.split("/");
  if (parts.some(part => !part || part.length > 255 || [".", "..", ".git", ".ssh", "node_modules"].includes(part.toLowerCase())
    || /^\.env(?:\.|$)/i.test(part) && !/^\.env\.(example|sample|template)$/i.test(part)
    || [".npmrc", ".pypirc", ".netrc"].includes(part.toLowerCase()))) throw invalid();
  return path;
}

export function projectFileBytes(file: ProjectFile): Buffer {
  if (typeof file === "string") return Buffer.from(file, "utf8");
  if (!file || typeof file !== "object" || Array.isArray(file)
    || Object.keys(file).sort().join() !== "content,encoding,mediaType" || file.encoding !== "base64"
    || typeof file.content !== "string" || typeof file.mediaType !== "string"
    || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.mediaType)) throw invalid();
  const bytes = Buffer.from(file.content, "base64");
  if (bytes.toString("base64") !== file.content) throw invalid();
  return bytes;
}
export function projectFileHash(file: ProjectFile): string {
  return `sha256:${createHash("sha256").update(projectFileBytes(file)).digest("hex")}`;
}

export function validateProjectFiles(files: Record<string, ProjectFile>) {
  const paths = Object.keys(files).sort();
  const present = new Set(paths);
  if (paths.length > 512) throw invalid();
  let total = 0;
  paths.forEach(path => {
    projectFilePath(path);
    const segments = path.split("/");
    if (segments.some((_, index) => index > 0 && present.has(segments.slice(0, index).join("/")))) throw invalid();
    const size = projectFileBytes(files[path]).byteLength;
    if (size > 512_000 || (total += size) > 4_000_000) throw invalid();
  });
}

export function applyFileChanges(previous: Record<string, ProjectFile>, changes: ProjectFileChange[]) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 512) throw invalid();
  const next = structuredClone(previous), changed = new Set<string>();
  for (const change of changes) {
    if (!change || typeof change !== "object" || !["write", "delete"].includes(change.operation)) throw invalid();
    const expectedKeys = change.operation === "write" ? "beforeHash,content,operation,path" : "beforeHash,operation,path";
    if (Object.keys(change).sort().join() !== expectedKeys) throw invalid();
    const path = projectFilePath(change.path);
    if (changed.has(path)) throw invalid();
    changed.add(path);
    const exists = Object.hasOwn(previous, path);
    if (change.beforeHash === null ? exists : !exists || change.beforeHash !== projectFileHash(previous[path])) {
      throw new ProjectError("project-file-conflict", "A file changed. Read the current revision before editing it.", 409);
    }
    if (change.operation === "write") Object.defineProperty(next, path, { value: structuredClone(change.content), enumerable: true, configurable: true, writable: true });
    else delete next[path];
  }
  validateProjectFiles(next);
  return next;
}

export function assertExportableFiles(files: Record<string, ProjectFile>) {
  validateProjectFiles(files);
  for (const file of Object.values(files)) {
    if (containsInlineCredential(projectFileBytes(file).toString("utf8"))) {
      throw new ProjectError("project-secret", "Remove inline credentials and use a private project connection before exporting.", 409);
    }
  }
}

export function assertExportableMetadata(value: unknown, depth = 0): void {
  if (depth > 32) throw invalid();
  if (typeof value === "string" && containsInlineCredential(value)) throw new ProjectError("project-secret", "Remove inline credentials before saving or exporting.", 409);
  if (Array.isArray(value)) { for (const item of value) assertExportableMetadata(item, depth + 1); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(api[_-]?key|secret|password|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)$/i.test(key)
      && typeof item === "string" && item && !/^(?:<[^>]+>|YOUR_[A-Z_]+|\$\{[A-Z_]+\})$/.test(item)) {
      throw new ProjectError("project-secret", "Remove inline credentials and use a private project connection before exporting.", 409);
    }
    assertExportableMetadata(item, depth + 1);
  }
}
