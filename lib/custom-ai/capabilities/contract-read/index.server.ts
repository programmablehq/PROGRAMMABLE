import "server-only";
import { defineTool } from "../definition.server";
import { readContractKnowledge } from "../../knowledge.server";
import type { KnowledgeLookup } from "../../knowledge";
export default defineTool("contract", "Read basic contract metadata at an exact supplied address on the selected network. No audit or signing authority.",
  (input, context) => readContractKnowledge(input as KnowledgeLookup, context.signal));
