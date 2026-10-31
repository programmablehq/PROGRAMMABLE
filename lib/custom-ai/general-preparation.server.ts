import "server-only";
import { getAddress } from "viem";
import { requireFreshCustomAIAuthority, type AIAuthority } from "./auth.server";
import { BackendLaunchRejected, type createCustomAIBackendLaunchBridge } from "./backend-launch.server";
import { createGeneralPublicSource, generalSourcePublicUri } from "./public-launch-source.server";
import { packGeneralGraph } from "./general-pack.server";
import { readLaunchProductionContext } from "./launch-production.server";
import { generalPreparationView, type GeneralExchangeOperation } from "./general-preparation-store.server";
import { projectGeneralGraphReply } from "./general-launch-response.server";
import type { GeneralLaunchSourceSelection } from "./general-launch-source.server";
import type { AIStore } from "./store.server";
import { CustomAIError } from "./types";

export function createGeneralPreparationService(deps: {
  store: AIStore;
  image: (owner:string,image:NonNullable<Awaited<ReturnType<AIStore["projects"]["readForLaunch"]>>["binding"]["image"]>,signal:AbortSignal)=>Promise<Uint8Array>;
  bridge: () => ReturnType<typeof createCustomAIBackendLaunchBridge>;
  pack?: typeof packGeneralGraph; production?: typeof readLaunchProductionContext; now?:()=>number;
}) {
  const preparations=deps.store.projects.preparations, now=deps.now??Date.now;
  function linked(request:Request,authority:AIAuthority,account:string) {
    const current=requireFreshCustomAIAuthority(request,authority), wallet=getAddress(account);
    if(!current.principal.wallets.some(value=>getAddress(value)===wallet))
      throw new CustomAIError("wallet","Select the linked wallet that owns this saved preparation.",403);
    return current;
  }
  return {
    async prepare(request:Request,authority:AIAuthority,input:{id:string;selection:GeneralLaunchSourceSelection;nativeFundingWei?:string}) {
      input=structuredClone(input);
      const current=linked(request,authority,input.selection.account);
      if(input.selection.chainId===4663)throw new CustomAIError("launch-plan-preparation","This network needs its current Launch Plan preparation. The saved source stays on its selected network.",422);
      const reserved=await preparations.reserve(current.owner,input.id,input.selection,input.nativeFundingWei);
      if(!reserved.lease || !reserved.source)return generalPreparationView(reserved.record,now());
      const {record,source,lease}=reserved;
      try {
        const context=await (deps.production??readLaunchProductionContext)(record.chainId,request.signal);
        if(context.id!==record.productionId)throw new CustomAIError("launch-context-changed","The network configuration changed. Update this saved design before preparing it.",409);
        const image=source.binding.image;
        if(!image)throw new CustomAIError("launch-image","Choose the saved coin image before preparing it.",422);
        const bytes=await deps.image(current.owner,image,request.signal), exported=createGeneralPublicSource(source);
        const packed=await (deps.pack??packGeneralGraph)({source,exported,url:generalSourcePublicUri(exported.id),controller:record.account,
          identity:record.identity,imageBytes:bytes,...(record.nativeFundingWei===undefined?{}:{nativeFundingWei:record.nativeFundingWei})},request.signal);
        linked(request,authority,record.account);
        return generalPreparationView(await preparations.completePack(current.owner,record.id,lease,packed),now());
      } catch(error) {
        await preparations.failPack(current.owner,record.id,lease,error instanceof CustomAIError?error.code:"launch-pack-worker").catch(()=>undefined);
        throw error;
      }
    },
    async exchange(request:Request,authority:AIAuthority,id:string,operation:GeneralExchangeOperation) {
      const current=requireFreshCustomAIAuthority(request,authority), saved=await preparations.read(current.owner,id);
      if(!saved)throw new CustomAIError("launch-preparation-missing","Open your saved launch preparation first.",404);
      linked(request,authority,saved.account);
      // Completed work and an active send only need the compact owned journal.
      // In particular, ordinary polling never repeats discovery or submission.
      const previous=operation==="create"?saved.submission:saved.preflight;
      if(previous?.state==="completed" || previous?.state==="sending" && previous.until>now())return generalPreparationView(saved,now());
      const context=await (deps.production??readLaunchProductionContext)(saved.chainId,request.signal,{fresh:true});
      if(context.id!==saved.productionId)throw new CustomAIError("launch-context-changed","The network configuration changed. Keep this original request and update the design before a new submission.",409);
      linked(request,authority,saved.account);
      const claimed=await preparations.claimExchange(current.owner,id,operation,context.id);
      if(!claimed.lease||!claimed.pack)return generalPreparationView(claimed.record,now());
      const {record,lease,pack}=claimed;
      try {
        const reply=await deps.bridge().submit(request,authority,{chainId:record.chainId,operation,account:record.account,
          bodyBytes:Buffer.from(pack.requestBody),idempotencyKey:operation==="create"?record.idempotencyKey:null});
        const summary=projectGeneralGraphReply(operation,reply,record);
        return generalPreparationView(await preparations.finishExchange(current.owner,id,operation,lease,{state:"completed",summary,reply:reply.value}),now());
      } catch(error) {
        // Any unconfirmed create retains its original identity and blocks a new
        // ticket. An explicit retry can send only these exact saved bytes.
        const rejected=error instanceof BackendLaunchRejected && error.backendStatus<500;
        await preparations.finishExchange(current.owner,id,operation,lease,{state:rejected?"rejected":"unknown",summary:{
          ...(error instanceof BackendLaunchRejected?{httpStatus:error.backendStatus,...(error.backendCode?{code:error.backendCode}:{})}:{code:"RESPONSE_UNCONFIRMED"})}}).catch(()=>undefined);
        throw error;
      }
    },
  };
}
