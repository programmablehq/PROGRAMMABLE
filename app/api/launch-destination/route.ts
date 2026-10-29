import { readHyperEvmExploreCatalog } from "@/lib/server/hyperevm-explore";
import { readBaseExploreCatalog } from "@/lib/server/base-explore";
import { readEthereumCustomExploreCatalog } from "@/lib/server/ethereum-explore";
import { readRobinhoodExploreCatalog } from "@/lib/server/robinhood-index/read";
import { indexedLaunchDestination, launchDestinationIdentity, type DestinationEntry } from "@/lib/launch-destination";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=15;
const headers={"Cache-Control":"no-store"};
export async function GET(request:Request) {
  const identity=launchDestinationIdentity(new URL(request.url).searchParams);
  if (!identity) return Response.json({error:"Invalid launch identity"},{status:400,headers});
  try {
    let entries:DestinationEntry[];
    if (identity.chainId==="1") {
      const catalog=await readEthereumCustomExploreCatalog();
      if (catalog.status==="unavailable") throw Error("Unavailable");
      entries=catalog.entries.flatMap(row=>row.launchStampProvenance?.chainId===1 ? [{chainId:"1" as const,launchId:row.launchStampProvenance.launchId,
        controller:row.launchStampProvenance.launchWallet,transactionHash:row.launchStampProvenance.transactionHash,tokenAddress:row.tokenAddress}] : []);
    } else if (identity.chainId === "999") {
      const catalog = await readHyperEvmExploreCatalog();
      entries = catalog.items.map(row => ({chainId:"999" as const,launchId:row.launchId,controller:row.creator,transactionHash:row.transactionHash,tokenAddress:row.tokenAddress}));
    } else if (identity.chainId === "8453") {
      const catalog = await readBaseExploreCatalog();
      entries = catalog.items.map(row => ({chainId:"8453" as const, launchId:row.launchId, controller:row.creator, transactionHash:row.transactionHash, tokenAddress:row.tokenAddress}));
    } else {
      const catalog=await readRobinhoodExploreCatalog();
      if (catalog.status==="unavailable") throw Error("Unavailable");
      entries=catalog.items.map(row=>({chainId:"4663" as const,launchId:row.launchId,controller:row.creator,transactionHash:row.transactionHash,tokenAddress:row.tokenAddress}));
    }
    const result=indexedLaunchDestination(entries,identity);
    return Response.json(result??{schemaVersion:"programmable.website-launch-destination.v1",status:"pending"},{status:result?200:202,headers});
  } catch { return Response.json({error:"Your confirmed launch is waiting for the website index"},{status:503,headers}); }
}
