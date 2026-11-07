import { createHash } from "node:crypto";
import type { IntentRequirement } from "../launch-intent";
import { ProjectError, type JsonValue, type ProjectDocument, type ProjectPatch, type ProjectScope } from "./types";

const inputError = () => new ProjectError("project-input", "This project change is invalid.");
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function validateScope(scope: ProjectScope) {
  if (!object(scope) || !text(scope.ownerId, 512) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.projectId)) throw inputError();
}

export function canonicalProjectJSON(value: JsonValue | unknown): string {
  const normalize = (input: unknown, depth: number): JsonValue => {
    if (depth > 32) throw inputError();
    if (input === null || typeof input === "boolean" || typeof input === "string") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(item => normalize(item, depth + 1));
    if (!object(input)) throw inputError();
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key], depth + 1)]));
  };
  return JSON.stringify(normalize(value, 0));
}
export const projectHash = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalProjectJSON(value)).digest("hex")}`;

function requirements(value: unknown): asserts value is IntentRequirement[] {
  if (!Array.isArray(value) || value.length > 128) throw inputError();
  const ids = new Set<string>();
  for (const rule of value) {
    if (!object(rule) || !identifier(rule.id) || ids.has(rule.id) || !text(rule.text, 8000)
      || !["behavior", "constraint", "decision"].includes(String(rule.kind)) || rule.open !== null && !text(rule.open, 4000)
      || !object(rule.origin)) throw inputError();
    const origin = rule.origin;
    if (origin.kind === "message") {
      if (!text(origin.requestId, 128) || !Number.isSafeInteger(origin.messageIndex) || Number(origin.messageIndex) < 0 || !text(origin.quote, 16000)) throw inputError();
    } else if (origin.kind === "legacy") {
      if (origin.requestId !== undefined && !text(origin.requestId, 128) || origin.sourceHash !== undefined && !text(origin.sourceHash, 128)) throw inputError();
    } else throw inputError();
    ids.add(rule.id);
  }
}

export function validateDocument(document: unknown): asserts document is ProjectDocument {
  if (!object(document) || Object.keys(document).sort().join() !== "architecture,dependencies,files,requirements,title"
    || !text(document.title, 120) || !object(document.files) || !object(document.dependencies)) throw inputError();
  requirements(document.requirements);
  const files = Object.entries(document.files);
  if (files.length > 512 || Object.entries(document.dependencies).some(([name, version]) => !text(name, 256) || !text(version, 512))) throw inputError();
  for (const [path, content] of files) {
    if (!text(path, 512) || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || [".", "..", ".git", "node_modules"].includes(part))
      || typeof content !== "string" || Buffer.byteLength(content) > 512_000) throw inputError();
  }
  if (Buffer.byteLength(canonicalProjectJSON(document)) > 4_000_000) throw inputError();
}

export function applyDocumentPatch(previous: ProjectDocument, patch: ProjectPatch): ProjectDocument {
  if (!object(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !["title", "requirements", "files", "dependencies", "architecture", "removeRequirementIds"].includes(key))) throw inputError();
  const { removeRequirementIds = [], ...changes } = structuredClone(patch);
  if (!Array.isArray(removeRequirementIds) || removeRequirementIds.some(id => !identifier(id)) || new Set(removeRequirementIds).size !== removeRequirementIds.length) throw inputError();
  const next = { ...structuredClone(previous), ...changes };
  validateDocument(next);
  const oldIds = new Set(previous.requirements.map(rule => rule.id)), nextIds = new Set(next.requirements.map(rule => rule.id));
  if (removeRequirementIds.some(id => !oldIds.has(id) || nextIds.has(id))
    || previous.requirements.some(rule => !nextIds.has(rule.id) && !removeRequirementIds.includes(rule.id))) {
    throw new ProjectError("project-requirements", "Keep existing requirements or explicitly identify the ones to remove.", 409);
  }
  return next;
}

export const emptyProjectDocument = (): ProjectDocument => ({ title: "New project", requirements: [], files: {}, dependencies: {}, architecture: null });
