export type LaunchDestinationIdentity = { chainId:"1"|"4663"; launchId:string; controller:string; transactionHash:string };
export type IndexedDestination = LaunchDestinationIdentity & { schemaVersion:"programmable.website-launch-destination.v1"; status:"indexed"; tokenAddress:string; href:string };
export type DestinationEntry = LaunchDestinationIdentity & { tokenAddress:string };
const address = /^0x[0-9a-f]{40}$/i;
const hash = /^0x[0-9a-f]{64}$/i;
export function launchDestinationIdentity(query: URLSearchParams): LaunchDestinationIdentity | null {
  const fields = ["chainId","launchId","controller","transactionHash"];
  if ([...query.keys()].some(key=>!fields.includes(key)) || fields.some(key=>query.getAll(key).length!==1)) return null;
  const chainId=query.get("chainId"), launchId=query.get("launchId")!, controller=query.get("controller")!, transactionHash=query.get("transactionHash")!;
  if ((chainId!=="1"&&chainId!=="4663") || !hash.test(launchId) || !address.test(controller) || !hash.test(transactionHash)) return null;
  return {chainId,launchId:launchId.toLowerCase(),controller:controller.toLowerCase(),transactionHash:transactionHash.toLowerCase()};
}
export function indexedLaunchDestination(entries: readonly DestinationEntry[], identity:LaunchDestinationIdentity): IndexedDestination | null {
  const matching = entries.filter(entry=>entry.chainId===identity.chainId && entry.launchId.toLowerCase()===identity.launchId.toLowerCase()
    && entry.controller.toLowerCase()===identity.controller.toLowerCase() && entry.transactionHash.toLowerCase()===identity.transactionHash.toLowerCase());
  if (matching.length!==1 || !address.test(matching[0].tokenAddress)) return null;
  const tokenAddress=matching[0].tokenAddress.toLowerCase();
  return {...identity,launchId:identity.launchId.toLowerCase(),controller:identity.controller.toLowerCase(),transactionHash:identity.transactionHash.toLowerCase(),schemaVersion:"programmable.website-launch-destination.v1",status:"indexed",tokenAddress,href:`/token/${tokenAddress}?chain=${identity.chainId}`};
}
export function parseLaunchDestination(value:unknown, identity:LaunchDestinationIdentity): IndexedDestination | null {
  if (!value || typeof value!=="object") return null;
  const row=value as Record<string,unknown>;
  if (row.schemaVersion!=="programmable.website-launch-destination.v1" || row.status!=="indexed" || row.chainId!==identity.chainId
    || row.launchId!==identity.launchId.toLowerCase() || row.controller!==identity.controller.toLowerCase()
    || row.transactionHash!==identity.transactionHash.toLowerCase() || typeof row.tokenAddress!=="string" || !address.test(row.tokenAddress)
    || row.href!==`/token/${row.tokenAddress.toLowerCase()}?chain=${identity.chainId}`) return null;
  return row as IndexedDestination;
}
