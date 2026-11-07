import {authorizeCustomAI,requireFreshCustomAIAuthority} from "@/lib/custom-ai/auth.server";
import {productionAIPool,productionAIStore} from "@/lib/custom-ai/store.server";
import {CustomAIError} from "@/lib/custom-ai/types";
import {productionPlatformStore,productionPlatformArtifacts} from "@/lib/custom-ai/platform/production.server";
import {productionProjectChecks} from "@/lib/custom-ai/platform/agent-production.server";
import {createPlatformLaunchDrafts} from "@/lib/custom-ai/platform/launch-draft.server";
import {createPlatformContractCheckpoints} from "@/lib/custom-ai/platform/contract-checkpoint.server";
import {createPlatformLaunchRoutes} from "@/lib/custom-ai/platform/launch-http.server";
export const runtime="nodejs";
const drafts=()=>createPlatformLaunchDrafts(productionAIPool());
const routes=()=>createPlatformLaunchRoutes({enabled:()=>process.env.CUSTOM_AI_PLATFORM_ENABLED==="true",authorize:async(request,write)=>{
 const authority=await authorizeCustomAI(request,false,true);if(authority.kind!=="account")throw new CustomAIError("auth","Connect your wallet to open a launch.",401);if(write)requireFreshCustomAIAuthority(request,authority);return {ownerId:authority.owner,wallets:authority.principal.wallets};
},consume:(owner,write)=>productionAIStore().consume(owner,`platform-launch-${write?"write":"read"}`,write?30:120),drafts,checkpoints:()=>createPlatformContractCheckpoints(productionAIPool(),{projects:productionPlatformStore(),artifacts:productionPlatformArtifacts(),checks:productionProjectChecks(),drafts:drafts()})});
export const GET=(request:Request)=>routes().GET(request);
export const POST=(request:Request)=>routes().POST(request);
