"use client";
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Check, History, Pencil, Plus, Search, Undo2, X } from "lucide-react";
import { aiRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import { type ConversationItem, type ConversationPage } from "@/lib/custom-ai/conversation";
import { readDraftCache, writeDraftCache } from "@/lib/custom-ai/draft-cache";
import styles from "./workspace.module.css";
type Flush=()=>Promise<unknown>;
export type ChatNavigation={pending:boolean;tools:(locked:boolean)=>ReactNode;newChat:()=>Promise<void>;registerFlush:(flush:Flush)=>()=>void};
const LibraryContext=createContext<{id:string;navigation:ChatNavigation}|undefined>(undefined);
export const useChatLibrary=()=>useContext(LibraryContext);
/** Owns only selection and metadata. Each keyed session owns its reply receiver. */
export function ChatLibrary({account,headers,children}:{account:string;headers:AISessionHeaders;children:ReactNode}){
  const [selected,setSelected]=useState<string>(),[page,setPage]=useState<ConversationPage>({conversations:[]}),[open,setOpen]=useState(false);
  const transition=useRef(false),[transitioning,setTransitioning]=useState(false);
  const [search,setSearch]=useState(""),[archived,setArchived]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const root=useRef<HTMLDivElement|null>(null);
  const [editing,setEditing]=useState<string>(),[title,setTitle]=useState("");
  const flushRef=useRef<Flush|null>(null);const flush=()=>flushRef.current?.()??Promise.resolve();
  const registerFlush=(save:Flush)=>{flushRef.current=save;return()=>{if(flushRef.current===save)flushRef.current=null;};};
  const apiHeaders=useRef(headers);useEffect(()=>{apiHeaders.current=headers;},[headers]);
  const key=`programmable.custom-ai.selected.v1:${account}`,generation=useRef(0),listAbort=useRef<AbortController|null>(null);
  const load=useCallback(async(q:string,archive:boolean,cursor?:string)=>{
    const seq=++generation.current;listAbort.current?.abort();const controller=new AbortController();listAbort.current=controller;setLoading(true);setError("");
    try{
      const result=await aiRequest<ConversationPage>(`/conversations?account=${encodeURIComponent(account)}&q=${encodeURIComponent(q)}&archived=${archive}${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,()=>apiHeaders.current(),undefined,controller.signal);
      if(seq===generation.current)setPage(current=>cursor?{...result,conversations:[...current.conversations,...result.conversations].filter((chat,index,rows)=>rows.findIndex(item=>item.id===chat.id)===index)}:result);
      return result;
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Your chats could not load.");return null;}
    finally{if(seq===generation.current)setLoading(false);}
  },[account]);
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    void (async()=>{
      try{
        await aiRequest<ConversationItem>("/conversations",()=>apiHeaders.current(),{account,action:"bootstrap"},controller.signal);
        const saved=await readDraftCache<string>(key),result=await load("",false);
        if(!active||!result)return;
        let choice=result.conversations.find(c=>c.id===saved);
        if(!choice&&saved)try{const current=await aiRequest<ConversationItem>(`/conversations?account=${encodeURIComponent(account)}&id=${encodeURIComponent(saved)}`,()=>apiHeaders.current(),undefined,controller.signal);if(!current.archived)choice=current;}catch{/* A deleted local selection never changes a saved chat. */}
        if(!active)return;choice??=result.conversations[0];
        if(choice)setSelected(choice.id);else setOpen(true);
      }catch(cause){if(active)setError(cause instanceof Error?cause.message:"Your chats could not load.");}
    })();
    return()=>{active=false;controller.abort();listAbort.current?.abort();};
  },[account,key,load]);
  useEffect(()=>{
    if(!open)return;const timer=setTimeout(()=>{void load(search,archived);},250);return()=>clearTimeout(timer);
  },[open,search,archived,load]);
  useEffect(()=>{
    if(!open)return;
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);root.current?.querySelector<HTMLButtonElement>("button")?.focus();}};
    const outside=(event:PointerEvent)=>{if(event.target instanceof Element&&!event.target.closest("[data-custom-ai-library]"))setOpen(false);};
    document.addEventListener("keydown",close);document.addEventListener("pointerdown",outside);
    return()=>{document.removeEventListener("keydown",close);document.removeEventListener("pointerdown",outside);};
  },[open]);
  async function select(id:string,flush:Flush){
    if(transition.current)return;transition.current=true;setTransitioning(true);
    setError("");try{await flush();await writeDraftCache(key,id);setSelected(id);setOpen(false);setEditing(undefined);}catch(cause){setError(cause instanceof Error?cause.message:"The current chat could not be saved.");}finally{transition.current=false;setTransitioning(false);}
  }
  async function newChat(){
    if(transition.current)return;transition.current=true;setTransitioning(true);
    setLoading(true);setError("");try{
      await flush();const result=await aiRequest<ConversationItem>("/conversations",()=>apiHeaders.current(),{account,action:"create",id:crypto.randomUUID()});
      await writeDraftCache(key,result.id);setSelected(result.id);setOpen(false);setSearch("");setArchived(false);setEditing(undefined);
    }catch(cause){setOpen(true);setError(cause instanceof Error?cause.message:"A new chat could not be opened.");}finally{transition.current=false;setTransitioning(false);setLoading(false);}
  }
  async function update(chat:ConversationItem,patch:{title?:string;archived?:boolean},flush:Flush){
    if(transition.current)return;transition.current=true;setTransitioning(true);
    setLoading(true);setError("");try{
      await flush();
      // Flushing may have renamed or advanced the metadata. Read its latest
      // revision, then use compare-and-set rather than overwriting another tab.
      const current=await aiRequest<ConversationItem>(`/conversations?account=${encodeURIComponent(account)}&id=${encodeURIComponent(chat.id)}`,()=>apiHeaders.current());
      const result=await aiRequest<ConversationItem>("/conversations",()=>apiHeaders.current(),{account,action:"update",id:chat.id,revision:current.revision,...patch});
      setEditing(undefined);
      const list=await load(search,archived);
      if(result.archived&&selected===chat.id){setSelected(undefined);await writeDraftCache(key,null);setOpen(true);if(list?.conversations[0])setSelected(list.conversations[0].id);}
    }catch(cause){setError(cause instanceof Error?cause.message:"The chat could not be updated.");}finally{transition.current=false;setTransitioning(false);setLoading(false);}
  }
  const panel=(locked:boolean)=><div className={styles.chatLibrary} ref={root} data-custom-ai-library="true">
    <button type="button" className={styles.libraryToggle} disabled={locked} aria-expanded={open} aria-controls="custom-ai-chats" onClick={()=>{setOpen(!open);setEditing(undefined);}}><History size={16} aria-hidden="true"/>Chats</button>
    {open&&<section id="custom-ai-chats" className={styles.libraryPanel} aria-label="Your saved chats">
      <header><strong>Your chats</strong><button type="button" aria-label="Close chat list" onClick={()=>setOpen(false)}><X size={16}/></button></header>
      <button type="button" disabled={locked||loading} onClick={()=>void newChat()}><Plus size={16} aria-hidden="true"/>New chat</button>
      <label className={styles.librarySearch}><Search size={16} aria-hidden="true"/><span className={styles.srOnly}>Search your chats</span><input value={search} onChange={e=>setSearch(e.target.value)} maxLength={80} placeholder="Search chats"/></label>
      <label className={styles.archiveFilter}><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Show archived</label>
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
  if(!selected)return <div className={styles.libraryEmpty}>{panel(transitioning)}{error&&!open&&<p role="alert">{error}</p>}{!error&&!open&&<p role="status">Loading your chats…</p>}</div>;
  return <LibraryContext.Provider value={{id:selected,navigation:{pending:transitioning,tools:panel,newChat,registerFlush}}}><Fragment key={selected}>{children}</Fragment></LibraryContext.Provider>;
}
