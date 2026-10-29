import { EvmSwapError,prepareHyperEvmFeeClaim } from "@/lib/server/swap/evm-custom";
import { BoundedBodyErrorV1, readBoundedUtf8BodyV1 } from "@/lib/server/custom-launch/bounded-utf8-body-v1";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=45;
export async function POST(request:Request){
 const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
 let input:unknown;try{input=JSON.parse(await readBoundedUtf8BodyV1(request,2048,{signal:request.signal}));}catch(error){
  const status=error instanceof BoundedBodyErrorV1?(error.code==="too-large"?413:["timeout","aborted"].includes(error.code)?408:400):400;
  return Response.json({error:status===413?"Request too large.":status===408?"Fee request timed out.":"Invalid fee request."},{status,headers});
 }
 try{return Response.json(await prepareHyperEvmFeeClaim(input),{headers});}
 catch(error){return Response.json({error:error instanceof EvmSwapError?error.message:"Fee claim is temporarily unavailable."},{status:error instanceof EvmSwapError?error.status:503,headers});}
}
