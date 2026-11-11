import { createPrivyWalletPrincipalAuthenticatorV1, WalletPrincipalAuthenticationErrorV1 } from "@/lib/server/creator-article/wallet-principal.server";
import { readBoundedUtf8BodyV1 } from "@/lib/server/custom-launch/bounded-utf8-body-v1";
import { productionTradeRpcsV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { readLaunchSendResolutionV1 } from "@/lib/server/custom-launch/launch-send-resolution-v1";
import { parseLaunchSendAttemptV1 } from "@/lib/custom-launch/launch-send-journal-v1";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { CustomAIError } from "@/lib/custom-ai/types";

export const runtime="nodejs";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request,context:{params:Promise<{launchId:string}>}) {
  try {
    const url=new URL(request.url),origin=request.headers.get("origin");
    if(origin&&origin!==url.origin)return Response.json({error:"Open this launch on Programmable."},{status:403,headers});
    const principal=await createPrivyWalletPrincipalAuthenticatorV1().authenticate(request);
    const controller=url.searchParams.get("walletAddress")??"";
    if(!principal.wallets.some(wallet=>wallet.toLowerCase()===controller.toLowerCase())||url.searchParams.get("source")!=="custom_launch_plan_v1"
      ||[...url.searchParams.keys()].some(key=>!["walletAddress","source"].includes(key)||url.searchParams.getAll(key).length!==1))return Response.json({error:"Use the original linked controller wallet."},{status:403,headers});
    let attempt;
    try {
      const body=JSON.parse(await readBoundedUtf8BodyV1(request,1_048_576,{signal:request.signal}));
      if(!body||Object.keys(body).join()!=="attempt")throw Error("Invalid request");
      attempt=parseLaunchSendAttemptV1(JSON.stringify(body.attempt),controller);
    }catch{return Response.json({error:"Use the saved wallet attempt."},{status:400,headers});}
    if(!attempt||attempt.sourceVersion!=="custom_launch_plan_v1"||attempt.launchId!==(await context.params).launchId
      ||!/^0x(?:[a-f0-9]{2})*$/i.test(attempt.transaction.data)||!/^0x[0-9a-f]+$/i.test(attempt.transaction.value))return Response.json({error:"Use the saved wallet attempt."},{status:400,headers});
    await productionAIStore().consume(principal.privyUserId,"launch-send-resolution",6,60_000);
    const resolution=await readLaunchSendResolutionV1(attempt,productionTradeRpcsV1(),request.signal);
    return Response.json({resolution},{headers});
  }catch(error){
    const status=error instanceof WalletPrincipalAuthenticationErrorV1||error instanceof CustomAIError?error.status:503;
    return Response.json({error:"The original transaction could not be resolved yet. Its recovery record is kept."},{status,headers:{...headers,"Retry-After":"30"}});
  }
}
