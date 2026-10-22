import { createHash } from "node:crypto";

// PostgreSQL jsonb does not retain object key order. Bind all compiler output
// values while preserving array order (including ABI parameters).
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]),
  );
  return value;
}

export function artifactHash(artifact) {
  return createHash("sha256").update(JSON.stringify(canonical(artifact))).digest("hex");
}
