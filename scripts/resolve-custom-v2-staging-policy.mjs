import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateBoundVercelProductionMetadata } from "./perf/read-model-deploy-policy.mjs";

const READ_BINDING = "PROGRAMMABLE_GENERIC_LAUNCH_READ_BINDING_V2_JSON";
const PROJECTOR_PATH = "/api/ops/custom-launch/generic-v2-projector";
const PROJECTOR_BINDINGS = new Set([
  READ_BINDING,
  "PROGRAMMABLE_GENERIC_LAUNCH_READ_MODEL_CONTRACT_V2_JSON",
  "PROGRAMMABLE_GENERIC_LAUNCH_PROJECTOR_TOKEN",
  "PROGRAMMABLE_APPROVAL_V3_ARTIFACT_VERIFIER_BINDING_JSON",
  "PROGRAMMABLE_WEBSITE_APPROVAL_V3_AUDIENCE",
  "PROGRAMMABLE_WEBSITE_APPROVAL_V3_TARGET_BINDING_HASH",
]);

function boolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("Custom V2 requested expectations must be boolean");
}

// Resolve expectations from the reviewed deployment and value-free production
// metadata before building. This never changes configuration or activates reads.
export function resolveCustomV2StagingPolicy({
  deploymentSource, metadataSource, projectId, projectConfig,
  requestedRegistryLive = false, requestedGenericReady = false,
}) {
  validateBoundVercelProductionMetadata(metadataSource, projectId);
  if (!deploymentSource || typeof deploymentSource !== "object" || Array.isArray(deploymentSource)
    || deploymentSource.schemaVersion !== "programmable.custom-registry-v2-deployment.v1"
    || deploymentSource.generation !== "2" || deploymentSource.chainId !== "1"
    || deploymentSource.caip2 !== "eip155:1"
    || !["prelaunch", "live"].includes(deploymentSource.status)
    || deploymentSource.publicReadEnabled !== (deploymentSource.status === "live")
    || deploymentSource.indexingEnabled !== (deploymentSource.status === "live")) {
    throw new Error("Reviewed Registry V2 deployment mode is invalid");
  }
  const production = JSON.parse(metadataSource).envs.filter(entry => entry.target.includes("production"));
  const bindings = production.filter(entry => entry.key === READ_BINDING);
  if (bindings.length > 1 || bindings.some(entry => entry.gitBranch
    || entry.customEnvironmentIds?.length)) {
    throw new Error("Generic V2 production binding is ambiguous");
  }
  const registryMode = deploymentSource.status;
  const genericMode = bindings.length ? "ready" : "disabled";
  if (genericMode === "ready" && registryMode !== "live") {
    throw new Error("Generic V2 read binding requires the reviewed live Registry");
  }
  if (boolean(requestedRegistryLive) && registryMode !== "live") {
    throw new Error("Requested live Registry V2 differs from the reviewed configuration");
  }
  if (boolean(requestedGenericReady) && genericMode !== "ready") {
    throw new Error("Requested ready Generic V2 differs from production configuration");
  }
  // Authenticated ingress can use the projector before public reads are active.
  const projectorConfigured = production.some(entry => PROJECTOR_BINDINGS.has(entry.key) &&
    !entry.gitBranch && !entry.customEnvironmentIds?.length);
  if (!Array.isArray(projectConfig?.crons)) throw new Error("Production cron inventory is missing");
  const jobs = projectConfig.crons.filter(job => job.path === PROJECTOR_PATH);
  if (jobs.length !== Number(projectorConfigured) || jobs.some(job => job.schedule !== "* * * * *")) {
    throw new Error("Generic V2 minute schedule does not match the production projector bindings");
  }
  return Object.freeze({ registryMode, genericMode });
}

function main(argv) {
  const required = ["deployment-file", "metadata-file", "project-id", "registry-live", "generic-ready", "github-output"];
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/u, ""), value = argv[index + 1];
    if (!required.includes(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) {
      throw new Error("Invalid Custom V2 staging policy arguments");
    }
    args[name] = value;
  }
  if (required.some(name => !args[name])) throw new Error("Missing Custom V2 staging policy argument");
  const read = (file, max) => {
    const bytes = readFileSync(resolve(file));
    if (bytes.length > max) throw new Error("Custom V2 policy input exceeds its limit");
    return bytes.toString("utf8");
  };
  const result = resolveCustomV2StagingPolicy({
    deploymentSource: JSON.parse(read(args["deployment-file"], 65_536)),
    projectConfig: JSON.parse(read("vercel.json", 65_536)),
    metadataSource: read(args["metadata-file"], 1_000_000), projectId: args["project-id"],
    requestedRegistryLive: args["registry-live"], requestedGenericReady: args["generic-ready"],
  });
  appendFileSync(args["github-output"], `registry_mode=${result.registryMode}\ngeneric_mode=${result.genericMode}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: "resolved", ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Custom V2 policy failed"); process.exitCode = 1; }
}
