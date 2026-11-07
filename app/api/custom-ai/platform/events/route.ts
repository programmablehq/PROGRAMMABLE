import {authorizeCustomAI,requireFreshCustomAIAuthority} from "@/lib/custom-ai/auth.server";
import {productionAIStore} from "@/lib/custom-ai/store.server";
import {productionPlatformStore} from "@/lib/custom-ai/platform/production.server";
import {productionGameEvents,productionGameEventService} from "@/lib/custom-ai/platform/event-production.server";
import {createGameEventRoutes} from "@/lib/custom-ai/platform/event-http.server";
import {ProjectError} from "@/lib/custom-ai/platform/types";
export const runtime="nodejs";
export const maxDuration=120;
const routes=()=>createGameEventRoutes({enabled:()=>process.env.CUSTOM_AI_PLATFORM_ENABLED==="true",events:productionGameEvents,service:productionGameEventService,projects:productionPlatformStore,
 authorize:async(request,write)=>{const authority=await authorizeCustomAI(request,false,true);if(authority.kind!=="account")throw new ProjectError("auth","Sign in to manage game connections.",401);if(write)requireFreshCustomAIAuthority(request,authority);return {ownerId:authority.owner,wallets:authority.principal.wallets};},
 consume:(owner,operation)=>productionAIStore().consume(owner,`platform-game-${operation}`,operation==="read"?120:30)});
export const GET=(request:Request)=>routes().GET(request);
export const POST=(request:Request)=>routes().POST(request);
