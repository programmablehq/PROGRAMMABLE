import { describe, expect, it } from "vitest";
import { indexedLaunchDestination, launchDestinationIdentity, parseLaunchDestination, type DestinationEntry } from "@/lib/launch-destination";
const identity={chainId:"1" as const,launchId:`0x${"1".repeat(64)}`,controller:`0x${"2".repeat(40)}`,transactionHash:`0x${"3".repeat(64)}`};
const entry:DestinationEntry={...identity,tokenAddress:`0x${"4".repeat(40)}`};
describe("confirmed launch destination",()=>{
  it("resolves only a unique exact launch, controller, transaction and chain",()=>{
    const result=indexedLaunchDestination([entry],identity)!;
    expect(result.href).toBe(`/token/${entry.tokenAddress}?chain=1`);
    expect(parseLaunchDestination(result,identity)).toEqual(result);
    for(const change of [{chainId:"4663" as const},{controller:`0x${"5".repeat(40)}`},{launchId:`0x${"6".repeat(64)}`},{transactionHash:`0x${"7".repeat(64)}`}]) expect(indexedLaunchDestination([{...entry,...change}],identity)).toBeNull();
    expect(indexedLaunchDestination([entry,entry],identity)).toBeNull();
    expect(indexedLaunchDestination([],identity)).toBeNull();
  });
  it("rejects alternate or external navigation and incomplete identities",()=>{
    const result=indexedLaunchDestination([entry],identity)!;
    expect(parseLaunchDestination({...result,href:"https://example.com"},identity)).toBeNull();
    expect(parseLaunchDestination({...result,chainId:"4663"},identity)).toBeNull();
    expect(parseLaunchDestination({...result,status:"pending"},identity)).toBeNull();
    const query=new URLSearchParams(identity);
    expect(launchDestinationIdentity(query)).toEqual(identity);
    query.append("controller",identity.controller);
    expect(launchDestinationIdentity(query)).toBeNull();
    expect(launchDestinationIdentity(new URLSearchParams({...identity,chainId:"2"}))).toBeNull();
  });
});
