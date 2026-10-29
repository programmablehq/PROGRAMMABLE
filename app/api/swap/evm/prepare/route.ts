import { EvmSwapError, prepareHyperEvmSwap, readHyperEvmSwapDescriptor } from "@/lib/server/swap/evm-custom";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function GET(request:Request){try{return json(await readHyperEvmSwapDescriptor(new URL(request.url).searchParams.get("token")??""));}catch(error){return json({error:error instanceof EvmSwapError?error.message:"Trading information is temporarily unavailable."},error instanceof EvmSwapError?error.status:503);}}
export async function POST(request:Request){
 if(Number(request.headers.get("content-length")??0)>4096)return json({error:"Request too large."},413);
 let input:unknown;try{const text=await request.text();if(text.length>4096)return json({error:"Request too large."},413);input=JSON.parse(text);}catch{return json({error:"Invalid trade request."},400);}
 try{return json(await prepareHyperEvmSwap(input));}catch(error){return json({error:error instanceof EvmSwapError?error.message:"The trade could not be simulated. Check your balance and try again."},error instanceof EvmSwapError?error.status:503);}
}
