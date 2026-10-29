import { EvmSwapError,prepareHyperEvmFeeClaim } from "@/lib/server/swap/evm-custom";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=45;
export async function POST(request:Request){
 const headers={"Cache-Control":"no-store"};try{const text=await request.text();if(text.length>2048)return Response.json({error:"Request too large."},{status:413,headers});return Response.json(await prepareHyperEvmFeeClaim(JSON.parse(text)),{headers});}
 catch(error){return Response.json({error:error instanceof EvmSwapError?error.message:"Fee claim is temporarily unavailable."},{status:error instanceof EvmSwapError?error.status:503,headers});}
}
