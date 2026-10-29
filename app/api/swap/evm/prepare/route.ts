import { EvmSwapError, prepareHyperEvmSwap, readHyperEvmSwapDescriptor } from "@/lib/server/swap/evm-custom";
import { BoundedBodyErrorV1, readBoundedUtf8BodyV1 } from "@/lib/server/custom-launch/bounded-utf8-body-v1";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function GET(request:Request){try{return json(await readHyperEvmSwapDescriptor(new URL(request.url).searchParams.get("token")??""));}catch(error){return json({error:error instanceof EvmSwapError?error.message:"Trading information is temporarily unavailable."},error instanceof EvmSwapError?error.status:503);}}
export async function POST(request:Request){
 let input:unknown;try{input=JSON.parse(await readBoundedUtf8BodyV1(request,4096,{signal:request.signal}));}catch(error){
  const status=error instanceof BoundedBodyErrorV1?(error.code==="too-large"?413:["timeout","aborted"].includes(error.code)?408:400):400;
  return json({error:status===413?"Request too large.":status===408?"Trade request timed out.":"Invalid trade request."},status);
 }
 try{return json(await prepareHyperEvmSwap(input));}catch(error){return json({error:error instanceof EvmSwapError?error.message:"The trade could not be simulated. Check your balance and try again."},error instanceof EvmSwapError?error.status:503);}
}
