import { randomUUID, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import { CUSTOM_AI_SCHEMA, createAIStore, type AIStore } from "../lib/custom-ai/store.server";
import { conversationStorageId } from "../lib/custom-ai/conversation.server";
import { LEGACY_CONVERSATION } from "../lib/custom-ai/conversation";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type { ChatRequest } from "../lib/custom-ai/types";
const account="0x"+"1".repeat(40), other="0x"+"2".repeat(40);
let db:PGlite,store:AIStore;
beforeEach(async()=>{db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);let queue=Promise.resolve();store=createAIStore({connect:async()=>{const before=queue;let release!:()=>void;queue=new Promise<void>(resolve=>{release=resolve;});await before;return{query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};}},{hourlyUnits:100,dailyUnits:100,globalDailyUnits:100,concurrent:1});});
afterEach(async()=>{await db.close();});
const state=()=>({settings:EMPTY_COIN_SETUP,messages:[]});
const request=(id:string,revision:number):ChatRequest=>({id:randomUUID(),intent:"chat",messages:[{role:"user",content:"Build a rain fee"}],conversation:{id,account,revision}});
describe("private conversation storage",()=>{
  it("rejects a missing creation ID instead of writing malformed legacy metadata",async()=>{
    await expect(store.conversations.create("alice",account,undefined as unknown as string)).rejects.toMatchObject({code:"conversation"});
    expect((await store.conversations.list("alice",account)).conversations).toHaveLength(0);
  });
  it("preserves the original wallet studio key and separates new chat and wallet keys",()=>{
    expect(conversationStorageId(account)).toBe(createHash("sha256").update(account).digest("hex"));
    const id=randomUUID();expect(conversationStorageId(account,id)).not.toBe(conversationStorageId(account));
    expect(conversationStorageId(account,id)).not.toBe(conversationStorageId(other,id));
    expect(()=>conversationStorageId(account,"../chat")).toThrow();
  });
  it("migrates the original title without modifying its studio or recreating an archived chat",async()=>{
    const legacy=conversationStorageId(account),saved={...state(),settings:{...EMPTY_COIN_SETUP,name:"Original"},input:"unsent"};
    await store.saveObject("alice","studio",legacy,saved,0);
    const chat=await store.conversations.create("alice",account,LEGACY_CONVERSATION);expect(chat.title).toBe("Original");
    const archived=await store.conversations.update("alice",account,chat.id,chat.revision,{archived:true,title:"Kept"});
    expect(await store.conversations.create("alice",account,LEGACY_CONVERSATION)).toMatchObject({title:"Kept",archived:true,revision:archived.revision});
    expect((await store.readObject("alice","studio",legacy))?.value).toEqual(saved);
  });
  it("keeps search, archived pages, owners and linked wallets isolated",async()=>{
    const chat=await store.conversations.create("alice",account,randomUUID());
    await store.conversations.update("alice",account,chat.id,chat.revision,{title:"Rain 100%"});
    await store.conversations.create("alice",other,randomUUID());await store.conversations.create("bob",account,randomUUID());
    expect((await store.conversations.list("alice",account,{search:"100%"})).conversations).toHaveLength(1);
    expect((await store.conversations.list("alice",account,{search:"%_"})).conversations).toHaveLength(0);
    expect((await store.conversations.list("alice",account)).conversations).toHaveLength(1);
    const latest=(await store.conversations.list("alice",account)).conversations[0];
    await store.conversations.update("alice",account,chat.id,latest.revision,{archived:true});
    expect((await store.conversations.list("alice",account)).conversations).toHaveLength(0);
    const archived=(await store.conversations.list("alice",account,{archived:true})).conversations[0];
    await store.conversations.update("alice",account,chat.id,archived.revision,{archived:false});
    expect((await store.conversations.list("alice",account)).conversations[0].title).toBe("Rain 100%");
    await expect(store.conversations.update("bob",other,chat.id,1,{title:"foreign"})).rejects.toMatchObject({status:404});
  });
  it("paginates a stable account list without duplicate rows or invalid cursors",async()=>{
    for(let i=0;i<23;i++)await store.conversations.create("alice",account,randomUUID());
    const first=await store.conversations.list("alice",account);expect(first.conversations).toHaveLength(20);expect(first.cursor).toBeTruthy();
    const second=await store.conversations.list("alice",account,{cursor:first.cursor});expect(second.conversations).toHaveLength(3);expect(second.cursor).toBeUndefined();
    expect(new Set([...first.conversations,...second.conversations].map(c=>c.id)).size).toBe(23);
    await expect(store.conversations.list("alice",account,{cursor:"bad"})).rejects.toMatchObject({code:"cursor"});
  });
  it("rejects stale studio basis before charging or binding a paid job",async()=>{
    const chat=await store.conversations.create("alice",account,randomUUID()),id=conversationStorageId(account,chat.id);
    await store.saveObject("alice","studio",id,state(),0);
    await expect(store.reserve("alice",request(chat.id,0))).rejects.toMatchObject({code:"conflict"});
    expect((await store.usage("alice")).hourly.used).toBe(0);
    expect((await store.readObject<{activeRequest?:string}>("alice","conversation",id))?.value.activeRequest).toBeUndefined();
    const input=request(chat.id,1),reserved=await store.reserve("alice",input);
    expect(reserved.lease).toBeTruthy();expect((await store.reserve("alice",input)).lease).toBeNull();
    expect((await store.usage("alice")).hourly.used).toBe(5);
  });
  it("rejects injecting another chat's context through reservation or studio writes",async()=>{
    const a=await store.conversations.create("alice",account,randomUUID()),b=await store.conversations.create("alice",account,randomUUID());
    const input=request(a.id,0),lease=(await store.reserve("alice",input)).lease!;await store.finish("alice",input.id,lease,{reply:"Kept"});
    const foreign={...state(),contextId:input.id};
    await expect(store.saveObject("alice","studio",conversationStorageId(account,b.id),foreign,0)).rejects.toMatchObject({code:"context"});
    await store.saveObject("alice","studio",conversationStorageId(account,b.id),state(),0);
    await expect(store.reserve("alice",{...request(b.id,1),contextId:input.id})).rejects.toMatchObject({code:"conflict"});
    expect((await store.usage("alice")).hourly.used).toBe(1);
  });
  it("clears the recovery pointer only once the completed reply was saved in that chat",async()=>{
    const chat=await store.conversations.create("alice",account,randomUUID()),id=conversationStorageId(account,chat.id),input=request(chat.id,0);
    const lease=(await store.reserve("alice",input)).lease!;await store.finish("alice",input.id,lease,{reply:"Saved reply"});
    expect((await store.readObject<{activeRequest?:string}>("alice","conversation",id))?.value.activeRequest).toBe(input.id);
    await store.saveObject("alice","studio",id,{...state(),contextId:input.id},0);
    expect((await store.readObject<{activeRequest?:string}>("alice","conversation",id))?.value.activeRequest).toBeUndefined();
  });
  it("keeps a running chat recoverable and refuses archived requests without extra allowance",async()=>{
    const chat=await store.conversations.create("alice",account,randomUUID()),input=request(chat.id,0),lease=(await store.reserve("alice",input)).lease!;
    await expect(store.conversations.update("alice",account,chat.id,(await store.conversations.read("alice",account,chat.id))!.revision,{archived:true})).rejects.toMatchObject({code:"busy"});
    await store.finish("alice",input.id,lease,{reply:"Done"});await store.conversations.update("alice",account,chat.id,(await store.conversations.read("alice",account,chat.id))!.revision,{archived:true});
    await expect(store.reserve("alice",request(chat.id,0))).rejects.toMatchObject({code:"conversation"});
    expect((await store.usage("alice")).hourly.used).toBe(1);
  });
});
