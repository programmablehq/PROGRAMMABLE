import "server-only";
import { defineTool } from "../definition.server";
import { readWebKnowledge } from "../../knowledge.server";
import type { KnowledgeLookup } from "../../knowledge";
export default defineTool("web", "Research one public factual question with cited sources. Never establishes a coin feed or permission to execute.",
  async (input, context) => {
    const started=Date.now();let reported=false;
    try{return await readWebKnowledge((input as KnowledgeLookup).query,context.signal,value=>{reported=true;context.onProviderUsage?.(value);});}
    catch(error){if(!reported)context.onProviderUsage?.({model:"web-search",durationMs:Date.now()-started,inputTokens:null,outputTokens:null,completed:false});throw error;}
  }, context => context.allowWeb);
