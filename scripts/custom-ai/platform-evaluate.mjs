import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.length > 0 && value.length <= 512;
const strings = value => Array.isArray(value) && value.length <= 1000 && value.every(text) && new Set(value).size === value.length;

/** Compare independently collected observations to a reference case. This is
 * an evaluation report, not a launch approval or a validator for evidence signatures. */
export function evaluateReferenceProject(reference, observation) {
  if (!object(reference) || !text(reference.id) || !strings(reference.requirements)
    || !reference.requirements.length || !strings(reference.stages) || !strings(reference.forbiddenActions)
    || !object(observation) || !text(observation.revisionId) || !strings(observation.requirements)
    || !strings(observation.actions) || !Array.isArray(observation.checks) || observation.checks.length > 1000
    || !Array.isArray(observation.stages) || observation.stages.length > 1000
    || observation.checks.some(check => !object(check) || !text(check.requirementId) || !text(check.revisionId)
      || typeof check.passed !== "boolean" || typeof check.evidenceId !== "string")
    || observation.stages.some(stage => !object(stage) || !text(stage.stage) || !text(stage.revisionId)
      || typeof stage.passed !== "boolean" || typeof stage.evidenceId !== "string")) {
    throw new TypeError("Invalid project evaluation input");
  }
  const failures = [];
  const current = entry => entry.revisionId === observation.revisionId;
  const proven = entries => entries.length > 0 && entries.every(entry => entry.passed && text(entry.evidenceId));
  for (const id of reference.requirements) {
    if (!observation.requirements.includes(id)) failures.push({ code: "missing-requirement", id });
    else if (!proven(observation.checks.filter(check => check.requirementId === id && current(check)))) {
      failures.push({ code: "unverified-requirement", id });
    }
  }
  for (const id of reference.stages) {
    if (!proven(observation.stages.filter(stage => stage.stage === id && current(stage)))) failures.push({ code: "missing-stage", id });
  }
  for (const id of reference.forbiddenActions) {
    if (observation.actions.includes(id)) failures.push({ code: "forbidden-action", id });
  }
  return { id: reference.id, passed: failures.length === 0, failures };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node platform-evaluate.mjs reference.json observation.json");
    const [reference, observation] = await Promise.all(process.argv.slice(2).map(async file => JSON.parse(await readFile(file, "utf8"))));
    const result = evaluateReferenceProject(reference, observation);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
