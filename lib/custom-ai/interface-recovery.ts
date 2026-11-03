import { interfaceSchemaForGraph } from "./check-stage-wire";
import { prepareSurplusSchema } from "./surplus-schema.server";

/** Recover only a finished first interface array from private interrupted
 * output. Deployment bytes are discarded and must be declared separately.
 * The unchanged interface schema still checks every identity and value. */
export function recoverCompletedInterface(response: string, graph: Record<string, unknown>): string | undefined {
  if (new TextEncoder().encode(response).length > 96_000) return;
  const prefix = /^\s*(?:```(?:json)?\s*)?\{\s*"interfaces"\s*:\s*/u.exec(response);
  if (!prefix || response[prefix[0].length] !== "[") return;
  const start = prefix[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let end = start; end < response.length; end++) {
    const char = response[end];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "[") depth++;
    if (char !== "]" || --depth !== 0) continue;
    if (!/^\s*,\s*"(?:deployment|deploymentJson)"\s*:/u.test(response.slice(end + 1))) return;
    try {
      const interfaces: unknown = JSON.parse(response.slice(start, end + 1));
      return prepareSurplusSchema(interfaceSchemaForGraph(graph, false), true)
        .decode(JSON.stringify({ interfaces, deployment: null }));
    } catch { return; }
  }
}

/** A seller can emit a draft followed by one explicitly corrected object.
 * Accept only the complete replacement, never merge drafts or finish JSON.
 * This is limited to deployment data and the original graph-scoped schema. */
export function recoverCorrectedDeployment(response: string, graph: Record<string, unknown>): string | undefined {
  if (new TextEncoder().encode(response).length > 96_000) return;
  const text = response.trim();
  const objectEnd = (start: number) => {
    if (text[start] !== "{") return -1;
    let depth = 0, quoted = false, escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) return index + 1;
    }
    return -1;
  };
  const draftEnd = objectEnd(0);
  if (draftEnd < 0) return;
  const replacementStart = text.indexOf("{", draftEnd);
  if (replacementStart < 0) return;
  const explanation = text.slice(draftEnd, replacementStart);
  if (explanation.length > 2000 || /[{}\[\]]|```/u.test(explanation)
    || !/\b(?:corrected|correcting|correction|revised|replacement)\b/iu.test(explanation)) return;
  const replacementEnd = objectEnd(replacementStart);
  if (replacementEnd !== text.length) return;
  try {
    const draft: unknown = JSON.parse(text.slice(0, draftEnd));
    if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.keys(draft).join() !== "deployment") return;
    const schema = interfaceSchemaForGraph(graph, true);
    return prepareSurplusSchema({ type: "object", properties: { deployment: schema.properties.deployment },
      required: ["deployment"], additionalProperties: false }, true).decode(text.slice(replacementStart));
  } catch { return; }
}
