import {productionAIPool,productionAIStore} from "@/lib/custom-ai/store.server";
import {productionPlatformStore,productionPlatformArtifacts,productionProjectAuthority} from "@/lib/custom-ai/platform/production.server";
import {projectPlatformRollout} from "@/lib/custom-ai/platform/rollout.server";
import {productionProjectChecks} from "@/lib/custom-ai/platform/agent-production.server";
import {createPlatformLaunchDrafts} from "@/lib/custom-ai/platform/launch-draft.server";
import {createPlatformContractCheckpoints} from "@/lib/custom-ai/platform/contract-checkpoint.server";
import {createPlatformLaunchRoutes} from "@/lib/custom-ai/platform/launch-http.server";
export const runtime="nodejs";
const drafts=()=>createPlatformLaunchDrafts(productionAIPool());
const routes=()=>createPlatformLaunchRoutes({enabled:()=>projectPlatformRollout()!==null,authorize:async(request,write)=>{
 const authority=await productionProjectAuthority(request,write);return {ownerId:authority.owner,wallets:authority.principal.wallets};
},consume:(owner,write)=>productionAIStore().consume(owner,`platform-launch-${write?"write":"read"}`,write?30:120),drafts,checkpoints:()=>createPlatformContractCheckpoints(productionAIPool(),{projects:productionPlatformStore(),artifacts:productionPlatformArtifacts(),checks:productionProjectChecks(),drafts:drafts()})});
export const GET=(request:Request)=>routes().GET(request);
export const POST=(request:Request)=>routes().POST(request);
