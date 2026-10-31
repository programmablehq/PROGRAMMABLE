import "server-only";
import { createHash } from "node:crypto";
import { CustomAIError, type ChatRequest, type Draft } from "./types";
import type { EditTarget, RuleEdit } from "./design-edits";
import type { RuleSpecV2 } from "./rule-spec";
import { MAX_INTENT_REQUIREMENTS, type IntentOrigin, type IntentRequirement, type LaunchIntent } from "./launch-intent";
import { intentImplementationGaps } from "./intent-coverage.server";
export { intentImplementationGaps } from "./intent-coverage.server";

type ProposedRequirement = Pick<IntentRequirement, "id" | "text" | "kind" | "open"> & { instruction: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const boundedText = (value: unknown, length: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= length;

export function parseIntentRequirements(value: unknown): ProposedRequirement[] {
  if (!Array.isArray(value) || value.length > MAX_INTENT_REQUIREMENTS) throw new CustomAIError("intent", "The complete design was missing. Your saved rules are kept.", 502);
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id)
      || !boundedText(item.text, 600) || !["behavior", "constraint", "decision"].includes(item.kind)
      || typeof item.instruction !== "string" || item.instruction.length > 8000
      || item.open !== null && !boundedText(item.open, 600)) throw new CustomAIError("intent", "The complete design could not be read. Your saved rules are kept.", 502);
    ids.add(item.id);
    return { id: item.id, text: item.text, kind: item.kind, instruction: item.instruction, open: item.open };
  });
}

function origin(request: ChatRequest, quote: string, latestOnly: boolean): IntentOrigin {
  if (!quote.trim()) throw new CustomAIError("intent", "New rules need a reference to your request. Your saved rules are kept.", 502);
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const message = request.messages[i];
    if (message.role === "user" && message.content.includes(quote)) return { kind: "message", requestId: request.id, messageIndex: i, quote };
    if (latestOnly) break;
  }
  throw new CustomAIError("intent", "The rule does not match your request. Your saved rules are kept.", 502);
}

function seal(value: Omit<LaunchIntent, "revision">): LaunchIntent {
  return { ...value, revision: digest(value) };
}

/** Old results have no invented user quotes. Their preserved source and ids are
 * explicitly marked as legacy evidence until the user revises them. */
export function migrateLaunchIntent(input: {
  requestId?: string; draft?: Draft; ruleSpec?: RuleSpecV2; unresolved?: string[];
}): LaunchIntent | undefined {
  if (input.draft?.intent) return input.draft.intent;
  const spec = input.ruleSpec ?? input.draft?.composable?.spec;
  const rules = spec?.requirements ?? input.draft?.verification?.requirements.map((text, index) => ({ id: `legacy-${digest([index, text]).slice(0, 16)}`, text }));
  if (!rules?.length) return undefined;
  const source: IntentOrigin = { kind: "legacy", ...(input.requestId ? { requestId: input.requestId } : {}), ...(input.draft ? { sourceHash: input.draft.sourceHash } : {}) };
  return seal({ version: 1, id: input.requestId ?? `legacy-${digest(rules).slice(0, 32)}`,
    requirements: [...rules.map(rule => ({ ...rule, kind: "behavior" as const, origin: source, open: null })),
      ...[...new Set(input.unresolved ?? [])].map(text => ({ id: `legacy-open-${digest(text).slice(0, 16)}`, text, kind: "decision" as const, origin: source, open: text }))],
    unresolved: input.unresolved ?? [], changes: [] });
}

/** Missing or unauthorized edits preserve the old requirement in the returned
 * design. A partial proposal cannot become the next turn's smaller authority. */
export function reviseLaunchIntent(input: {
  previous?: LaunchIntent; proposed: ProposedRequirement[]; unresolved: string[]; edits: RuleEdit[];
  request: ChatRequest; target?: EditTarget;
}) {
  const { previous, proposed, edits, request, target } = input;
  if (input.unresolved.some(question => !proposed.some(rule => rule.open === question))) {
    throw new CustomAIError("intent", "Keep each open question with its requested rule. Your saved design is kept.", 502);
  }
  const prior = new Map(previous?.requirements.map(rule => [rule.id, rule]));
  const following = new Map(proposed.map(rule => [rule.id, rule]));
  const problems: string[] = [];
  const requirements: IntentRequirement[] = [];
  const changes: LaunchIntent["changes"] = [];
  for (const edit of edits) {
    if (!prior.has(edit.requirementId) || target && edit.requirementId !== target.requirementId
      || (edit.operation === "remove" ? following.has(edit.requirementId) : !following.has(edit.requirementId))) problems.push("The requested edit does not match the complete saved design.");
  }
  for (const [id, rule] of prior) {
    const next = following.get(id), edit = edits.find(edit => edit.requirementId === id);
    if (edit && (!target || target.requirementId === id)) {
      if (edit.operation === "remove" && !next) { changes.push({ requirementId: id, operation: "remove", origin: origin(request, edit.instruction, true) }); continue; }
      if (edit.operation === "replace" && next) {
        const source = origin(request, edit.instruction, true);
        requirements.push({ id, text: next.text, kind: next.kind, open: next.open, origin: source });
        changes.push({ requirementId: id, operation: "replace", origin: source });
        continue;
      }
    }
    requirements.push(rule);
    if (!next || next.text !== rule.text || next.kind !== rule.kind || next.open !== rule.open) problems.push(rule.text);
  }
  for (const rule of proposed) if (!prior.has(rule.id)) {
    if (target) { problems.push("Keep this edit focused on the selected rule."); continue; }
    const source = origin(request, rule.instruction, Boolean(previous));
    requirements.push({ id: rule.id, text: rule.text, kind: rule.kind, open: rule.open, origin: source });
    changes.push({ requirementId: rule.id, operation: "add", origin: source });
  }
  if (requirements.length > MAX_INTENT_REQUIREMENTS) throw new CustomAIError("intent", "This design has too many separate requirements. Keep your saved design and split the next change.", 422);
  if (!requirements.length && !previous) throw new CustomAIError("intent", "Describe the complete rules before building.", 502);
  const unresolved = [...new Set([...input.unresolved, ...requirements.flatMap(rule => rule.open ? [rule.open] : [])])];
  for (const question of previous?.unresolved ?? []) {
    const owners = previous!.requirements.filter(rule => rule.open === question);
    const resolved = owners.length > 0 && owners.every(rule => changes.some(change => change.requirementId === rule.id));
    if (!unresolved.includes(question) && !resolved) { unresolved.push(question); problems.push(question); }
  }
  if (previous && JSON.stringify(requirements) === JSON.stringify(previous.requirements)
    && JSON.stringify(unresolved) === JSON.stringify(previous.unresolved) && changes.length === 0) return { intent: previous, problems: [...new Set(problems)] };
  const intent = seal({ version: 1, id: previous?.id ?? request.id, ...(previous ? { parentRevision: previous.revision } : {}), requirements, unresolved, changes });
  return { intent, problems: [...new Set(problems)] };
}

/** Called only after the existing compiler/validator succeeds. This records a
 * source binding, never public activation or semantic proof of arbitrary code. */
export function bindCandidateIntent(intent: LaunchIntent, draft: Draft, previous?: Draft): Draft {
  if (intent.unresolved.length || intent.requirements.some(rule => rule.open !== null)
    || !draft.compiled || draft.validation?.status !== "passed" || !draft.validation.artifactHash || draft.verification?.status !== "passed"
    || draft.verification.sourceHash !== draft.sourceHash
    || intentImplementationGaps(intent, draft.composable?.spec.requirements ?? draft.verification.requirements.map(text => ({ text }))).length) {
    throw new CustomAIError("intent", "The complete design has not passed its source checks.", 422);
  }
  const binding = { ...(previous?.revision ? { parentRevision: previous.revision.id } : {}), intentRevision: intent.revision,
    sourceHash: draft.sourceHash, artifactHash: draft.validation.artifactHash, requirementIds: intent.requirements.map(rule => rule.id),
    executionRoute: draft.composable ? "composed-module" as const : "fee-module" as const };
  return { ...draft, intent, revision: { id: digest(binding), ...binding } };
}
