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
