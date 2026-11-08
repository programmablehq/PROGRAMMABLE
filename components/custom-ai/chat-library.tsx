"use client";
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Check, History, Pencil, Plus, Search, Undo2, X } from "lucide-react";
import { aiRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import { type ConversationItem, type ConversationPage } from "@/lib/custom-ai/conversation";
import { readDraftCache, writeDraftCache } from "@/lib/custom-ai/draft-cache";
import { scopedCacheKeys } from "@/lib/custom-ai/cache-scope";
import styles from "./workspace.module.css";
import { WorkspacePending } from "./workspace-pending";
type Flush=()=>Promise<unknown>;
export type ChatNavigation={pending:boolean;tools:(locked:boolean)=>ReactNode;newChat:()=>Promise<void>;registerFlush:(flush:Flush)=>()=>void};
const LibraryContext=createContext<{id:string;cacheScope:string;navigation:ChatNavigation}|undefined>(undefined);
export const useChatLibrary=()=>useContext(LibraryContext);
/** Owns only selection and metadata. Each keyed session owns its reply receiver. */
export function ChatLibrary({account,headers,initialConversationId,children}:{account:string;headers:AISessionHeaders;initialConversationId?:string;children:ReactNode}){
  const entryConversation=useRef(initialConversationId);
  const [selected,setSelected]=useState<string>(),[page,setPage]=useState<ConversationPage>({conversations:[]}),[open,setOpen]=useState(false);
  const transition=useRef(false),[transitioning,setTransitioning]=useState(false);
  const pendingCreate=useRef<string>(undefined);
  const [search,setSearch]=useState(""),[archived,setArchived]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(""),[listError,setListError]=useState("");
  const root=useRef<HTMLDivElement|null>(null);
  const toggle=useRef<HTMLButtonElement|null>(null);
  const close=()=>{setOpen(false);setEditing(undefined);toggle.current?.focus();};
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
    const seq=++generation.current;listAbort.current?.abort();const controller=new AbortController();listAbort.current=controller;setLoading(true);setListError("");
    try{
      const result=await aiRequest<ConversationPage>(`/conversations?account=${encodeURIComponent(account)}&q=${encodeURIComponent(q)}&archived=${archive}${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,scopedHeaders,undefined,controller.signal);
      if(seq===generation.current&&currentQuery())setPage(current=>cursor?{...result,conversations:[...current.conversations,...result.conversations].filter((chat,index,rows)=>rows.findIndex(item=>item.id===chat.id)===index)}:result);
      return result;
    }catch(cause){if(!controller.signal.aborted&&seq===generation.current&&currentQuery())setListError(cause instanceof Error?cause.message:"Your chats could not load.");return null;}
    finally{if(seq===generation.current&&currentQuery())setLoading(false);}
  },[account,scopedHeaders]);
  function filter(nextSearch:string,nextArchived:boolean){
    setError("");setListError("");
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
    root.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();setOpen(false);setEditing(undefined);toggle.current?.focus();}};
    const outside=(event:PointerEvent)=>{if(event.target instanceof Element&&!event.target.closest("[data-custom-ai-library]"))setOpen(false);};
    document.addEventListener("keydown",close);document.addEventListener("pointerdown",outside);
    return()=>{document.removeEventListener("keydown",close);document.removeEventListener("pointerdown",outside);};
  },[open]);
  async function select(id:string,flush:Flush){
    if(transition.current)return;transition.current=true;setTransitioning(true);
    setError("");try{await flush();await writeDraftCache(key.current,id);pendingCreate.current=undefined;setSelected(id);setOpen(false);setEditing(undefined);}catch(cause){setError(cause instanceof Error?cause.message:"The current chat could not be saved.");}finally{transition.current=false;setTransitioning(false);}
  }
  async function newChat(){
    if(transition.current)return;transition.current=true;setTransitioning(true);
    setLoading(true);setError("");try{
      // A lost response can still have created the chat. Reuse that identity
      // until both the server result and local selection are saved.
      await flush();pendingCreate.current??=crypto.randomUUID();
      const result=await aiRequest<ConversationItem>("/conversations",scopedHeaders,{account,action:"create",id:pendingCreate.current});
      if(result.id!==pendingCreate.current)throw Error("The new chat could not be confirmed. Try opening it again.");
      if(result.archived){pendingCreate.current=undefined;throw Error("That chat was archived. Create a new chat to continue.");}
      await writeDraftCache(key.current,result.id);setSelected(result.id);setOpen(false);filter("",false);setEditing(undefined);pendingCreate.current=undefined;
    }catch(cause){
      setOpen(true);
      // Creation may have succeeded before its response was lost. Refresh even
      // when the library is already open, so the saved chat can be recovered.
      await load(query.current.search,query.current.archived);
      setError(cause instanceof Error?cause.message:"A new chat could not be opened.");
    }finally{transition.current=false;setTransitioning(false);setLoading(false);}
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
      if(result.archived&&result.id===pendingCreate.current)pendingCreate.current=undefined;
      setEditing(undefined);
      // Metadata writes may outlive a filter change. Refresh the current view,
      // never the search/archive values captured when the write began.
      refreshed=true;const list=await load(query.current.search,query.current.archived);
      if(result.archived&&selected===chat.id){const replacement=list?.conversations.find(item=>!item.archived);setSelected(replacement?.id);await writeDraftCache(key.current,replacement?.id??null);setOpen(true);}
    }catch(cause){setError(cause instanceof Error?cause.message:"The chat could not be updated.");}finally{transition.current=false;setTransitioning(false);if(!refreshed)setLoading(false);}
  }
  const problem=error||listError;
  const panel=(locked:boolean)=><div className={styles.chatLibrary} ref={root} data-custom-ai-library="true">
    <button ref={toggle} type="button" className={styles.libraryToggle} disabled={locked} aria-expanded={open} aria-controls={open?"custom-ai-chats":undefined} onClick={()=>{setOpen(!open);setEditing(undefined);}}><History size={16} aria-hidden="true"/>Chats</button>
    <section hidden={!open} inert={!open} id="custom-ai-chats" className={styles.libraryPanel} aria-label="Your saved chats">
      <header><strong>Your chats</strong><button type="button" aria-label="Close chat list" onClick={close}><X size={16} aria-hidden="true"/></button></header>
      <button type="button" disabled={locked||transitioning||!cacheScope||loading&&!selected} onClick={()=>void newChat()}><Plus size={16} aria-hidden="true"/>New chat</button>
      <label className={styles.librarySearch}><Search size={16} aria-hidden="true"/><span className={styles.srOnly}>Search your chats</span><input type="search" value={search} onChange={e=>filter(e.target.value,query.current.archived)} maxLength={80} placeholder="Search chats"/></label>
      <label className={styles.archiveFilter}><input type="checkbox" checked={archived} onChange={e=>filter(query.current.search,e.target.checked)}/>Show archived</label>
      <div className={styles.libraryList} aria-busy={loading}>
        {page.conversations.map(chat=><article key={chat.id} data-current={selected===chat.id}>
          {editing===chat.id?<form onSubmit={e=>{e.preventDefault();void update(chat,{title},flush);}}><label className={styles.srOnly} htmlFor="chat-title">Chat name</label><input id="chat-title" autoFocus maxLength={80} value={title} onChange={e=>setTitle(e.target.value)}/><button type="submit" disabled={!title.trim()||transitioning} aria-label="Save chat name"><Check size={16}/></button><button type="button" aria-label="Cancel rename" onClick={()=>setEditing(undefined)}><X size={16}/></button></form>:
            <button type="button" className={styles.chatChoice} disabled={locked||chat.archived||transitioning} aria-current={selected===chat.id?"page":undefined} onClick={()=>void select(chat.id,flush)}><strong>{chat.title}</strong>{selected===chat.id&&<span className={styles.srOnly}>Current chat</span>}<small>{new Date(chat.updatedAt).toLocaleDateString()}</small></button>}
          <div className={styles.chatItemActions}><button type="button" disabled={transitioning||locked} aria-label={`Rename ${chat.title}`} onClick={()=>{setEditing(chat.id);setTitle(chat.title);}}><Pencil size={14}/></button>
            <button type="button" disabled={transitioning||locked} aria-label={`${chat.archived?"Restore":"Archive"} ${chat.title}`} onClick={()=>void update(chat,{archived:!chat.archived},flush)}>{chat.archived?<Undo2 size={15}/>:<Archive size={15}/>}</button></div>
        </article>)}
        {!loading&&!page.conversations.length&&<p>{archived?"No archived chats.":search?"No matching chats.":"Create a chat to start a new coin."}</p>}
      </div>
      {page.cursor&&<button type="button" disabled={loading} onClick={()=>void load(search,archived,page.cursor)}>More chats</button>}
      {loading&&<p role="status">Loading chats…</p>}
      {problem&&<p role="alert">{problem}</p>}
    </section>
  </div>;
  if(!selected||!cacheScope)return <WorkspacePending status={!problem&&!open?"Opening your chats…":""} navigation={()=>panel(transitioning)}>{problem&&<><p role="alert">{problem}</p><button type="button" className={styles.textButton} onClick={()=>{setError("");filter("",false);setBootstrapRevision(value=>value+1);}}>Reload chats</button></>}</WorkspacePending>;
  return <LibraryContext.Provider value={{id:selected,cacheScope,navigation:{pending:transitioning,tools:panel,newChat,registerFlush}}}><Fragment key={selected}>{children}</Fragment></LibraryContext.Provider>;
}
