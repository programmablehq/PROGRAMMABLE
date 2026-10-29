import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { canonicalizeJson } from "../packages/launch/src/canonical-json.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const networks = [
  { id: '8453', name: 'Base', slug: 'base', block: '52866196', blockHash: '0x77c7a70a0a1d538879c9247ba16efc716f1d2226b2c56d385daa6ddcd30d33b9' },
  { id: '999', name: 'HyperEVM', slug: 'hyperevm', block: '49851979', blockHash: '0x07ea8b3308abf3e60a7b21f0a18db13e17d576df15dec5d71ac4b0edf37112cd' },
];
for (const network of networks) {
const profile = read(`packages/launch/src/${network.slug}-profile-v1.json`);
const source = read("public/openapi/custom-launch-v3.6.json");
const legacy = read("public/openapi/custom-launch-v3.json");
const prefix = `/v4/chains/${network.id}`;
const replace = value => {
  if (Array.isArray(value)) return value.map(replace);
  if (value && typeof value === "object") {
    const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
    if (result.properties?.chainId?.const === "1") result.properties.chainId.const = network.id;
    if (result.properties?.chainId?.const === 1) result.properties.chainId.const = Number(network.id);
    return result;
  }
  return typeof value === "string" ? value.replaceAll("/v3/", prefix + "/")
    .replaceAll("Ethereum Mainnet", network.name).replaceAll("Ethereum mainnet", network.name)
    .replaceAll("programmable.ethereum-finalized-checkpoint-quorum.v1", `programmable.${network.slug}-launch-finalized-checkpoint-quorum.v1`) : value;
};
const schemas = replace(source.components.schemas);
// Resolve the chain-specific legacy schema before translating it. Keeping its
// external reference would still require Ethereum's checkpoint on Base.
schemas.FinalizedCheckpointV1 = replace(legacy.components.schemas.FinalizedCheckpointV1);
schemas.ProgrammableTradeFeePolicyV36 = { const: profile.programmableTradeFeePolicy };
const routingFee = schemas.RoutingFeePolicyBindingV36;
routingFee.properties.schemaVersion = { const: `programmable.${network.slug}-launch-routing-fee-policy-binding.v1` };
routingFee.properties.policyHash = { const: "sha256:" + createHash("sha256")
  .update(profile.programmableTradeFeePolicy.schemaVersion + "\0" + canonicalizeJson(profile.programmableTradeFeePolicy)).digest("hex") };
routingFee.properties.enforcementBoundary = {
  type: "object", required: ["chainId", "blockNumber", "blockHash", "releaseId"],
  properties: {
    chainId: { const: network.id }, blockNumber: { const: network.block },
    blockHash: { const: network.blockHash },
    releaseId: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
  }, additionalProperties: false,
};
delete routingFee.allOf;
schemas.DirectNativeHookGraphProfileV1 = { const: profile };
schemas.CustomLaunchCreateRequestV3.properties.launchProfile = { const: profile };
schemas.CustomLaunchCreateRequestV3.properties.chainId = { const: network.id };
for (const field of ["fundingAuthorization", "fundingIntentHash", "partnerAttribution"]) {
  if (schemas.CustomLaunchCreateRequestV3.properties[field]) schemas.CustomLaunchCreateRequestV3.properties[field] = false;
}
schemas.FinalizedCustomLaunchMetadataV1.properties.creator = { $ref: "./custom-launch-v2.json#/components/schemas/EthereumAddress" };
schemas.FinalizedCustomLaunchMetadataV1.properties.poolKey = { $ref: "#/components/schemas/DirectNativePoolKeyV1" };
schemas.FinalizedCustomLaunchMetadataV1.required.push("creator", "poolKey");
schemas.CustomLaunchCapabilitiesV1 = {
  type: "object", required: ["schemaVersion", "apiVersion", "chain", "serverTime", "releaseId", "mode", "publicLaunchAuthorized", "moduleMode", "profile", "routes", "authentication"],
  properties: {
    schemaVersion: { const: "programmable.custom-launch-capabilities.v1" }, apiVersion: { const: "v4" },
    chain: { const: { id: network.id, name: network.name } }, serverTime: { type: "string", format: "date-time" },
    releaseId: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, mode: { enum: ["disabled", "canary", "active"] },
    publicLaunchAuthorized: { type: "boolean" }, moduleMode: { const: false },
    profile: { type: "object", required: [...new Set([...Object.keys(profile), "productionLaunchAuthorized"])],
      properties: { ...Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, { const: value }])),
        productionLaunchAuthorized: { type: "boolean" } }, additionalProperties: false },
    routes: { type: "object" }, authentication: { type: "object" },
  },
  description: "Require mode active and publicLaunchAuthorized true for public launch availability. The canary mode admits only the release operator.",
};
const paths = {};
for (const route of ["/v3/capabilities", "/v3/finalized-custom-launches", "/v3/custom-launches/preflight", "/v3/custom-launches", "/v3/custom-launches/{launchId}"]) {
  paths[route.replace("/v3", prefix)] = replace(source.paths[route]);
}
paths[prefix + "/readiness"] = { get: { operationId: `${network.slug}CustomReadiness`, security: [],
  summary: `Current ${network.name} release readiness`, responses: {
    "200": { description: "The selected release is ready. Public creation additionally requires mode active and publicLaunchAuthorized true.",
      content: { "application/json": { schema: { type: "object", required: ["chainId", "releaseId", "mode", "ready", "publicLaunchAuthorized", "reasonCodes"],
        properties: { chainId: { const: network.id }, ready: { type: "boolean" }, mode: { enum: ["disabled", "canary", "active"] },
          publicLaunchAuthorized: { type: "boolean" }, releaseId: { type: "string" }, reasonCodes: { type: "array", items: { type: "string" } } } } } } },
    "503": { description: "Release prerequisites are unavailable; retry with backoff." },
  } } };
// Keep only schemas actually referenced by the supported Base routes.
const names = new Set();
const scan = value => {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/components/schemas/")) {
    const name = value.$ref.slice("#/components/schemas/".length);
    if (!names.has(name)) { names.add(name); scan(schemas[name]); }
  }
  for (const child of Object.values(value)) scan(child);
};
scan(paths);
const output = { openapi: "3.1.0", info: { title: `Programmable ${network.name} Custom Launch API`, version: "1.0.0",
  description: `${network.name} chain ${network.id}. Exact-source Custom Launch only. The request uses the graph V3 schema on a chain-qualified V4 URL. Module Mode and partner credentials are not enabled on this route.` },
  jsonSchemaDialect: source.jsonSchemaDialect, servers: [{ url: "https://api.programmable.market" }],
  externalDocs: { url: `https://programmable.market/developers/${network.slug}-custom-launch-api-v1.md` },
  security: source.security, paths, components: { ...source.components,
    schemas: Object.fromEntries([...names].sort().map(name => [name, schemas[name]])) } };
const file = path.join(root, `public/openapi/${network.slug}-custom-launch-v1.json`);
const bytes = JSON.stringify(output, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(file, "utf8") !== bytes) throw Error("Base OpenAPI is not current");
} else fs.writeFileSync(file, bytes);

}
