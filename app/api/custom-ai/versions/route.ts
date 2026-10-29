import { createHash } from "node:crypto";
import { getAddress } from "viem";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import type { StudioState, DraftVersion } from "@/lib/custom-ai/studio";
type SavedVersion={studioId:string;state:StudioState;sourceHash:string;summary?:string};
export const runtime="nodejs";
export async function GET(request:Request){
  try{
    const auth=await authorizeCustomAI(request);
    if(auth.kind!=="account")throw new CustomAIError("auth","Connect your wallet to see saved versions.",401);
    const query=new URL(request.url).searchParams,rawAccount=query.get("account")??"";
    if(!/^0x[0-9a-f]{40}$/i.test(rawAccount))throw new CustomAIError("input","Choose your connected wallet.",400);
    const account=getAddress(rawAccount);
    if(!auth.principal.wallets.some(w=>getAddress(w)===account))throw new CustomAIError("wallet","Select your connected wallet.",403);
    const studioId=createHash("sha256").update(account.toLowerCase()).digest("hex"),store=productionAIStore(),id=query.get("id");
    await store.consume(auth.owner,"versions",60);
    if(id){
      if(!/^[a-f0-9]{64}$/.test(id))throw new CustomAIError("input","Choose a saved version.",400);
      const v=(await store.readObject<SavedVersion>(auth.owner,"studio-version",id))?.value;
      if(!v||v.studioId!==studioId||!v.state.draftId)throw new CustomAIError("missing","That version was not found.",404);
      const draft=(await store.read(auth.owner,v.state.draftId))?.result?.draft;
      if(!draft||draft.sourceHash!==v.sourceHash)throw new CustomAIError("version","That version needs to be checked again before use.",409);
      return Response.json({state:v.state,draft},{headers:aiHeaders});
    }
    const rows=await store.draftVersions(auth.owner,studioId);
    const versions:DraftVersion[]=rows.map(row=>{const v=row.value as SavedVersion;return {id:String(row.id),createdAt:new Date(String(row.updated_at)).toISOString(),name:v.state.settings.name,summary:v.summary??"Saved rules",sourceHash:v.sourceHash,draftId:v.state.draftId!};});
    return Response.json({versions},{headers:aiHeaders});
  }catch(error){return aiError(error);}
}
