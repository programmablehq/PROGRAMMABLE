"use client";
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Check, History, Pencil, Plus, Search, Undo2, X } from "lucide-react";
import { aiRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import { type ConversationItem, type ConversationPage } from "@/lib/custom-ai/conversation";
import { readDraftCache, writeDraftCache } from "@/lib/custom-ai/draft-cache";
import { scopedCacheKeys } from "@/lib/custom-ai/cache-scope";
import styles from "./workspace.module.css";
type Flush=()=>Promise<unknown>;
export type ChatNavigation={pending:boolean;tools:(locked:boolean)=>ReactNode;newChat:()=>Promise<void>;registerFlush:(flush:Flush)=>()=>void};
const LibraryContext=createContext<{id:string;cacheScope:string;navigation:ChatNavigation}|undefined>(undefined);
export const useChatLibrary=()=>useContext(LibraryContext);
/** Owns only selection and metadata. Each keyed session owns its reply receiver. */
export function ChatLibrary({account,headers,initialConversationId,children}:{account:string;headers:AISessionHeaders;initialConversationId?:string;children:ReactNode}){
  const entryConversation=useRef(initialConversationId);
  const [selected,setSelected]=useState<string>(),[page,setPage]=useState<ConversationPage>({conversations:[]}),[open,setOpen]=useState(false);
  const transition=useRef(false),[transitioning,setTransitioning]=useState(false);
  const [search,setSearch]=useState(""),[archived,setArchived]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const root=useRef<HTMLDivElement|null>(null);
  const [editing,setEditing]=useState<string>(),[title,setTitle]=useState("");
  const flushRef=useRef<Flush|null>(null);const flush=()=>flushRef.current?.()??Promise.resolve();
  const registerFlush=(save:Flush)=>{flushRef.current=save;return()=>{if(flushRef.current===save)flushRef.current=null;};};
  const apiHeaders=useRef(headers);useEffect(()=>{apiHeaders.current=headers;},[headers]);
  const key=useRef(""),scope=useRef<string>(undefined),[cacheScope,setCacheScope]=useState<string>(),[bootstrapRevision,setBootstrapRevision]=useState(0);
  const generation=useRef(0),listAbort=useRef<AbortController|null>(null);
  const scopedHeaders=useCallback(async():Promise<Record<string,string>>=>({...await apiHeaders.current(),...(scope.current?{"X-Custom-AI-Cache-Scope":scope.current}:{})}),[]);
  const query=useRef({search:"",archived:false});
  const load=useCallback(async(q:string,archive:boolean,cursor?:string)=>{
    const currentQuery=()=>query.current.search===q&&query.current.archived===archive;
    if(!currentQuery())return null;
    const seq=++generation.current;listAbort.current?.abort();const controller=new AbortController();listAbort.current=controller;setLoading(true);setError("");
    try{
      const result=await aiRequest<ConversationPage>(`/conversations?account=${encodeURIComponent(account)}&q=${encodeURIComponent(q)}&archived=${archive}${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,scopedHeaders,undefined,controller.signal);
      if(seq===generation.current&&currentQuery())setPage(current=>cursor?{...result,conversations:[...current.conversations,...result.conversations].filter((chat,index,rows)=>rows.findIndex(item=>item.id===chat.id)===index)}:result);
      return result;
    }catch(cause){if(!controller.signal.aborted&&seq===generation.current&&currentQuery())setError(cause instanceof Error?cause.message:"Your chats could not load.");return null;}
    finally{if(seq===generation.current&&currentQuery())setLoading(false);}
  },[account,scopedHeaders]);
  function filter(nextSearch:string,nextArchived:boolean){
    query.current={search:nextSearch,archived:nextArchived};
    ++generation.current;listAbort.current?.abort();setPage({conversations:[]});setLoading(true);
    setSearch(nextSearch);setArchived(nextArchived);
  }
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    void (async()=>{
      try{
        const bootstrap=await aiRequest<ConversationItem&{cacheScope:string}>("/conversations",()=>apiHeaders.current(),{account,action:"bootstrap"},controller.signal);
        if(!active)return;
        key.current=scopedCacheKeys(bootstrap.cacheScope,account).selected;scope.current=bootstrap.cacheScope;setCacheScope(bootstrap.cacheScope);
        if(entryConversation.current){
          // The UUID belongs only to this explicit sign-in attempt. Repeating
          // bootstrap after a lost response reopens the same private chat.
          const entry=await aiRequest<ConversationItem>("/conversations",scopedHeaders,{account,action:"create",id:entryConversation.current},controller.signal);
          if(!active)return;
          await writeDraftCache(key.current,entry.id);
          if(active)setSelected(entry.id);
          return;
        }
        const saved=await readDraftCache<string>(key.current),result=await load("",false);
        if(!active||!result)return;
        let choice=result.conversations.find(c=>c.id===saved);
        if(!choice&&saved)try{const current=await aiRequest<ConversationItem>(`/conversations?account=${encodeURIComponent(account)}&id=${encodeURIComponent(saved)}`,scopedHeaders,undefined,controller.signal);if(!current.archived)choice=current;}catch{/* A deleted local selection never changes a saved chat. */}
        if(!active)return;choice??=result.conversations[0];
        if(choice)setSelected(choice.id);else setOpen(true);
      }catch(cause){if(active)setError(cause instanceof Error?cause.message:"Your chats could not load.");}
    })();
    return()=>{active=false;controller.abort();listAbort.current?.abort();};
  },[account,load,scopedHeaders,bootstrapRevision]);
  useEffect(()=>{
    if(!open||!cacheScope)return;const timer=setTimeout(()=>{void load(search,archived);},250);return()=>clearTimeout(timer);
  },[open,search,archived,load,cacheScope]);
  useEffect(()=>{
    if(!open)return;
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);root.current?.querySelector<HTMLButtonElement>("button")?.focus();}};
    const outside=(event:PointerEvent)=>{if(event.target instanceof Element&&!event.target.closest("[data-custom-ai-library]"))setOpen(false);};
    document.addEventListener("keydown",close);document.addEventListener("pointerdown",outside);
    return()=>{document.removeEventListener("keydown",close);document.removeEventListener("pointerdown",outside);};
  },[open]);
  async function select(id:string,flush:Flush){
    if(transition.current)return;transition.current=true;setTransitioning(true);
    setError("");try{await flush();await writeDraftCache(key.current,id);setSelected(id);setOpen(false);setEditing(undefined);}catch(cause){setError(cause instanceof Error?cause.message:"The current chat could not be saved.");}finally{transition.current=false;setTransitioning(false);}
  }
  async function newChat(){
    if(transition.current)return;transition.current=true;setTransitioning(true);
    setLoading(true);setError("");try{
      await flush();const result=await aiRequest<ConversationItem>("/conversations",scopedHeaders,{account,action:"create",id:crypto.randomUUID()});
      await writeDraftCache(key.current,result.id);setSelected(result.id);setOpen(false);filter("",false);setEditing(undefined);
    }catch(cause){setOpen(true);setError(cause instanceof Error?cause.message:"A new chat could not be opened.");}finally{transition.current=false;setTransitioning(false);setLoading(false);}
  }
  async function update(chat:ConversationItem,patch:{title?:string;archived?:boolean},flush:Flush){
    if(transition.current)return;transition.current=true;setTransitioning(true);
    let refreshed=false;
    setLoading(true);setError("");try{
      await flush();
      // Flushing may have renamed or advanced the metadata. Read its latest
      // revision, then use compare-and-set rather than overwriting another tab.
      const current=await aiRequest<ConversationItem>(`/conversations?account=${encodeURIComponent(account)}&id=${encodeURIComponent(chat.id)}`,scopedHeaders);
      const result=await aiRequest<ConversationItem>("/conversations",scopedHeaders,{account,action:"update",id:chat.id,revision:current.revision,...patch});
      setEditing(undefined);
      // Metadata writes may outlive a filter change. Refresh the current view,
      // never the search/archive values captured when the write began.
      refreshed=true;const list=await load(query.current.search,query.current.archived);
      if(result.archived&&selected===chat.id){const replacement=list?.conversations.find(item=>!item.archived);setSelected(replacement?.id);await writeDraftCache(key.current,replacement?.id??null);setOpen(true);}
    }catch(cause){setError(cause instanceof Error?cause.message:"The chat could not be updated.");}finally{transition.current=false;setTransitioning(false);if(!refreshed)setLoading(false);}
  }
  const panel=(locked:boolean)=><div className={styles.chatLibrary} ref={root} data-custom-ai-library="true">
    <button type="button" className={styles.libraryToggle} disabled={locked} aria-expanded={open} aria-controls="custom-ai-chats" onClick={()=>{setOpen(!open);setEditing(undefined);}}><History size={16} aria-hidden="true"/>Chats</button>
    {open&&<section id="custom-ai-chats" className={styles.libraryPanel} aria-label="Your saved chats">
      <header><strong>Your chats</strong><button type="button" aria-label="Close chat list" onClick={()=>setOpen(false)}><X size={16}/></button></header>
      <button type="button" disabled={locked||loading||!cacheScope} onClick={()=>void newChat()}><Plus size={16} aria-hidden="true"/>New chat</button>
      <label className={styles.librarySearch}><Search size={16} aria-hidden="true"/><span className={styles.srOnly}>Search your chats</span><input value={search} onChange={e=>filter(e.target.value,query.current.archived)} maxLength={80} placeholder="Search chats"/></label>
      <label className={styles.archiveFilter}><input type="checkbox" checked={archived} onChange={e=>filter(query.current.search,e.target.checked)}/>Show archived</label>
      <div className={styles.libraryList} aria-busy={loading}>
        {page.conversations.map(chat=><article key={chat.id} data-current={selected===chat.id}>
          {editing===chat.id?<form onSubmit={e=>{e.preventDefault();void update(chat,{title},flush);}}><label className={styles.srOnly} htmlFor="chat-title">Chat name</label><input id="chat-title" autoFocus maxLength={80} value={title} onChange={e=>setTitle(e.target.value)}/><button type="submit" disabled={!title.trim()||loading} aria-label="Save chat name"><Check size={16}/></button><button type="button" aria-label="Cancel rename" onClick={()=>setEditing(undefined)}><X size={16}/></button></form>:
            <button type="button" className={styles.chatChoice} disabled={locked||chat.archived||loading} aria-current={selected===chat.id?"page":undefined} onClick={()=>void select(chat.id,flush)}><strong>{chat.title}</strong><small>{new Date(chat.updatedAt).toLocaleDateString()}</small></button>}
          <div className={styles.chatItemActions}><button type="button" disabled={loading||locked} aria-label={`Rename ${chat.title}`} onClick={()=>{setEditing(chat.id);setTitle(chat.title);}}><Pencil size={14}/></button>
            <button type="button" disabled={loading||locked} aria-label={`${chat.archived?"Restore":"Archive"} ${chat.title}`} onClick={()=>void update(chat,{archived:!chat.archived},flush)}>{chat.archived?<Undo2 size={15}/>:<Archive size={15}/>}</button></div>
        </article>)}
        {!loading&&!page.conversations.length&&<p>{archived?"No archived chats.":search?"No matching chats.":"Create a chat to start a new coin."}</p>}
      </div>
      {page.cursor&&<button type="button" disabled={loading} onClick={()=>void load(search,archived,page.cursor)}>More chats</button>}
      {loading&&<p role="status">Loading chats…</p>}
      {error&&<p role="alert">{error}</p>}
    </section>}
  </div>;
  if(!selected||!cacheScope)return <div className={styles.libraryEmpty}>{panel(transitioning)}{error&&<><p role="alert">{error}</p><button type="button" onClick={()=>{setError("");filter("",false);setBootstrapRevision(value=>value+1);}}>Reload chats</button></>}{!error&&!open&&<p role="status">Loading your chats…</p>}</div>;
  return <LibraryContext.Provider value={{id:selected,cacheScope,navigation:{pending:transitioning,tools:panel,newChat,registerFlush}}}><Fragment key={selected}>{children}</Fragment></LibraryContext.Provider>;
}
