import "server-only";
import { defineTool } from "../definition.server";
import { readCatalogKnowledge } from "../../knowledge.server";
import type { KnowledgeLookup } from "../../knowledge";
export default defineTool("catalog", "Search verified Programmable launches and indexed markets on the requested network. Results retain their freshness status.",
  (input, context) => readCatalogKnowledge(input as KnowledgeLookup, context.signal));
