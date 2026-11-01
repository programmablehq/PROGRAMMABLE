import React, {type ComponentProps} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {DeveloperLaunchWorkspace} from "../components/developer-launch-workspace";
const captured=vi.hoisted(()=>({props:null as ComponentProps<typeof DeveloperLaunchWorkspace>|null}));
vi.mock("@/components/developer-launch-workspace",()=>({DeveloperLaunchWorkspace:(props:ComponentProps<typeof DeveloperLaunchWorkspace>)=>{captured.props=props;return null;}}));
import {DeveloperApiKeysView} from "../components/developer-api-keys";
import {developerApiKeysInitialSection} from "../lib/developer-api-key-route";

describe("first render of an owned launch handoff",()=>{
 beforeEach(()=>{captured.props=null;});
 it.each([undefined,"1","4663","8453","999"])("passes the exact destination before any effect for chain %s",chainId=>{
  const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",query=new URLSearchParams({launchId:id,...(chainId?{chainId}:{})});
  const token=vi.fn(async()=>null),wallet=vi.fn(async():Promise<`0x${string}`>=>{throw Error("Rendering cannot use a wallet");});
  renderToStaticMarkup(<DeveloperApiKeysView account={`0x${"1".repeat(40)}`} authReady={true} connecting={false}
   initialSection={developerApiKeysInitialSection(Object.fromEntries(query))} navigationQuery={query.toString()}
   getAccessToken={token} getIdentityToken={token} openWallet={vi.fn()} sendCustomLaunchWalletAction={wallet}
   sendCustomLaunchWalletActionV4={wallet} signCustomLaunchFundingAuthorization={wallet}/>);
  expect(captured.props).toMatchObject({initialLaunchId:id,initialLaunchChainId:chainId===undefined||chainId==="1"?null:chainId});
  expect(token).not.toHaveBeenCalled();expect(wallet).not.toHaveBeenCalled();
 });
});
