import "server-only";
import { defineTool, lookupInputSchema } from "../definition.server";
import { readContractKnowledge } from "../../knowledge.server";
import type { KnowledgeLookup } from "../../knowledge";
export default defineTool("contract", "Read basic contract metadata at an exact supplied address on the selected network. No audit or signing authority.",
  (input, context) => readContractKnowledge(input as KnowledgeLookup, context.signal),
  context=>context.chainId===1||context.chainId===4663,
  {...lookupInputSchema,properties:{...lookupInputSchema.properties,chainId:{enum:[1,4663]}}});
