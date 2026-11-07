import {productionAIStore} from "@/lib/custom-ai/store.server";
import {productionPlatformStore,productionProjectAuthority} from "@/lib/custom-ai/platform/production.server";
import {projectPlatformRollout} from "@/lib/custom-ai/platform/rollout.server";
import {productionGameEvents,productionGameEventService} from "@/lib/custom-ai/platform/event-production.server";
import {createGameEventRoutes} from "@/lib/custom-ai/platform/event-http.server";
export const runtime="nodejs";
export const maxDuration=120;
const routes=()=>createGameEventRoutes({enabled:()=>projectPlatformRollout()!==null,events:productionGameEvents,service:productionGameEventService,projects:productionPlatformStore,
 authorize:async(request,write)=>{const authority=await productionProjectAuthority(request,write);return {ownerId:authority.owner,wallets:authority.principal.wallets};},
 consume:(owner,operation)=>productionAIStore().consume(owner,`platform-game-${operation}`,operation==="read"?120:30)});
export const GET=(request:Request)=>routes().GET(request);
export const POST=(request:Request)=>routes().POST(request);
