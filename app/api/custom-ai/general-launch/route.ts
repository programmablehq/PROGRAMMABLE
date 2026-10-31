import { getAddress } from "viem";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { readPreviewBody } from "@/lib/custom-ai/access.server";
import { createCustomAIBackendLaunchBridge } from "@/lib/custom-ai/backend-launch.server";
import { parseGeneralPreparationAction } from "@/lib/custom-ai/general-preparation-input";
import { createGeneralPreparationService } from "@/lib/custom-ai/general-preparation.server";
import { generalPreparationView } from "@/lib/custom-ai/general-preparation-store.server";
import { readOwnedGeneralPackImage } from "@/lib/custom-ai/general-pack-image.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { CustomAIError } from "@/lib/custom-ai/types";

export const runtime="nodejs";
export const maxDuration=120;
const enabled=()=>{
  if(process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED!=="true")throw new CustomAIError("unavailable","General launch preparation is not available here yet.",404);
};
export async function GET(request:Request) {
  try {
    enabled();
    const authority=await authorizeCustomAI(request,false,true);
    if(authority.kind!=="account")throw new CustomAIError("auth","Connect your wallet to continue.",401);
    const query=new URL(request.url).searchParams,id=query.get("id"),account=query.get("account");
    if([...query.keys()].some(key=>!["id","account"].includes(key)||query.getAll(key).length!==1)||Boolean(id)===Boolean(account))
      throw new CustomAIError("launch-input","Open one saved launch preparation.",400);
    let wallet:string|undefined;
    if(account){try{wallet=getAddress(account);}catch{throw new CustomAIError("wallet","Select your linked launch wallet.",400);}}
    if(wallet&&!authority.principal.wallets.some(value=>getAddress(value)===wallet))throw new CustomAIError("wallet","Reconnect the launch wallet.",403);
    const store=productionAIStore();
    await store.consume(authority.owner,"general-launch-read",360);
    const saved=id?await store.projects.preparations.read(authority.owner,id):await store.projects.preparations.active(authority.owner,wallet!);
    if(saved&&!authority.principal.wallets.some(value=>getAddress(value)===getAddress(saved.account)))throw new CustomAIError("wallet","Reconnect the launch wallet.",403);
    return Response.json({preparation:saved?generalPreparationView(saved):null},{headers:aiHeaders});
  }catch(error){return aiError(error);}
}
export async function POST(request:Request) {
  try {
    enabled();
    const authority=await authorizeCustomAI(request,false,true);
    if(authority.kind!=="account")throw new CustomAIError("auth","Connect your wallet to continue.",401);
    const store=productionAIStore();
    await store.consume(authority.owner,"general-launch-control",120);
    const input=parseGeneralPreparationAction(await readPreviewBody(request));
    const service=createGeneralPreparationService({store,image:(owner,image,signal)=>readOwnedGeneralPackImage(store,owner,image,signal),
      bridge:()=>createCustomAIBackendLaunchBridge({backendBaseUrl:process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL!,
        websiteToken:process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN!,assertionKey:process.env.PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2!,fetchBackend:fetch})});
    const preparation=input.action==="prepare"?await service.prepare(request,authority,input):await service.exchange(request,authority,input.id,input.action);
    return Response.json({preparation},{headers:aiHeaders});
  }catch(error){return aiError(error);}
}
