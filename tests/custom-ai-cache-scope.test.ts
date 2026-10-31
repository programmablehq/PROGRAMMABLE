import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const authenticate=vi.hoisted(()=>vi.fn());
vi.mock("../lib/server/creator-article/wallet-principal.server",()=>({
  createPrivyWalletPrincipalAuthenticatorV1:()=>({authenticate}),
  WalletPrincipalAuthenticationErrorV1:class extends Error {},
}));
import { authorizeCustomAI } from "../lib/custom-ai/auth.server";
import { customAICacheScope } from "../lib/custom-ai/cache-scope.server";
import { canMigrateLegacyCache, scopedCacheKeys } from "../lib/custom-ai/cache-scope";
import type { StoredStudio } from "../lib/custom-ai/studio";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
const account="0x"+"a".repeat(40),job="owned-request-00000001";
const server=():StoredStudio=>({revision:1,state:{settings:EMPTY_COIN_SETUP,messages:[],contextId:job}});
beforeEach(()=>{vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED","true");authenticate.mockReset();authenticate.mockResolvedValue({privyUserId:"alice",wallets:[account]});});
afterEach(()=>vi.unstubAllEnvs());

describe("account-bound Custom AI browser state",()=>{
  it("uses distinct namespaces for different principals sharing one linked wallet",()=>{
    const alice=customAICacheScope("alice"),bob=customAICacheScope("bob");expect(alice).not.toBe(bob);
    expect(scopedCacheKeys(alice,account).studio).not.toBe(scopedCacheKeys(bob,account).studio);
    expect(scopedCacheKeys(alice,account).selected).not.toBe(scopedCacheKeys(bob,account).selected);
    expect(scopedCacheKeys(alice,account.toUpperCase().replace("0X","0x"))).toEqual(scopedCacheKeys(alice,account));
  });
  it("also separates wallets and chats without treating the namespace as a credential",()=>{
    const scope=customAICacheScope("alice"),keys=scopedCacheKeys(scope,account);
    expect(keys.studio).not.toBe(scopedCacheKeys(scope,"0x"+"b".repeat(40)).studio);
    expect(keys.studio).not.toBe(scopedCacheKeys(scope,account,"00000000-0000-4000-8000-000000000001").studio);
    for(const args of [["invented",account],[scope,"not-a-wallet"],[scope,account,"foreign-id"]])expect(()=>scopedCacheKeys(...args as [string,string,string?])).toThrow();
  });
  it("accepts an access-only session and its matching optional browser namespace",async()=>{
    const cases:Record<string,string>[]=[{},{"X-Custom-AI-Cache-Scope":customAICacheScope("alice")}];
    for(const headers of cases){
      expect(await authorizeCustomAI(new Request("https://site.test/api/custom-ai/studio",{headers}))).toMatchObject({kind:"account",owner:"alice"});
    }
  });
  it("rejects a stale namespace before a new principal can save the former account's state",async()=>{
    authenticate.mockResolvedValue({privyUserId:"bob",wallets:[account]});
    await expect(authorizeCustomAI(new Request("https://site.test/api/custom-ai/studio",{headers:{"X-Custom-AI-Cache-Scope":customAICacheScope("alice")}}))).rejects.toMatchObject({code:"session_changed",status:409});
  });
  it("requires the confirmed namespace before an older page can save or start a paid chat",async()=>{
    const request=(headers:Record<string,string>={})=>new Request("https://site.test/api/custom-ai/studio",{method:"POST",headers});
    await expect(authorizeCustomAI(request(),false,true)).rejects.toMatchObject({code:"session_changed",status:409});
    expect(await authorizeCustomAI(request({"X-Custom-AI-Cache-Scope":customAICacheScope("alice")}),false,true)).toMatchObject({kind:"account",owner:"alice"});
    expect(await authorizeCustomAI(new Request("https://site.test/api/custom-ai?id=owned"))).toMatchObject({kind:"account",owner:"alice"});
  });
  it("never upgrades a failed authentication because a client knows a cache namespace",async()=>{
    authenticate.mockRejectedValue(Error("session missing"));
    await expect(authorizeCustomAI(new Request("https://site.test/api/custom-ai/studio",{headers:{"X-Custom-AI-Cache-Scope":customAICacheScope("alice")}}))).rejects.toMatchObject({code:"auth",status:503});
  });
  it("cannot migrate an unbound local-only copy from a matching wallet or revision number",()=>{
    expect(canMigrateLegacyCache({version:1,syncBase:{revision:1},input:"Private to another principal"},server())).toBe(false);
    expect(canMigrateLegacyCache({version:1,contextId:job},null)).toBe(false);
    expect(canMigrateLegacyCache({version:1,contextId:"foreign-request-00001"},server())).toBe(false);
  });
  it("migrates only job references actually returned in the owned studio",()=>{
    expect(canMigrateLegacyCache({version:1,contextId:job,input:"Owned unsent change"},server())).toBe(true);
    expect(canMigrateLegacyCache({version:1,contextId:job,draftId:"foreign-request-00001"},server())).toBe(false);
    expect(canMigrateLegacyCache({version:1,retry:{id:job}},server())).toBe(true);
    expect(canMigrateLegacyCache({version:1,contextId:job,draft:{sourceHash:"foreign-source"}},server())).toBe(false);
    expect(canMigrateLegacyCache({version:1,contextId:job,image:{id:"foreign-image",hash:"foreign-hash"}},server())).toBe(false);
  });
});
