import "server-only";
import { defineTool, lookupInputSchema } from "../definition.server";
import { readContractKnowledge } from "../../knowledge.server";
import type { KnowledgeLookup } from "../../knowledge";
import { CustomAIError } from "../../types";
export default defineTool("contract", "Read exact-address contract metadata on the selected Ethereum, Robinhood, Base or HyperEVM network. Two existing providers, bounded read-only calls and a shared 30-second cache. No source audit, signing or launch approval.",
  (input, context) => {
    const lookup=input as KnowledgeLookup;
    if(lookup.chainId!==context.chainId)throw new CustomAIError("lookup","Use the currently selected network for this contract read.",422);
    return readContractKnowledge(lookup, context.signal);
  },()=>true,lookupInputSchema);
