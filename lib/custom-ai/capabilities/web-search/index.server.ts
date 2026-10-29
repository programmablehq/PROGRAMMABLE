import "server-only";
import { defineTool } from "../definition.server";
import { readWebKnowledge } from "../../knowledge.server";
import type { KnowledgeLookup } from "../../knowledge";
export default defineTool("web", "Research one public factual question with cited sources. Never establishes a coin feed or permission to execute.",
  (input, context) => readWebKnowledge((input as KnowledgeLookup).query, context.signal), context => context.allowWeb);
