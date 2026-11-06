"use client";

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Square, Wallet, X } from "lucide-react";
import { parseChatRequest, type ChatMessage, type ChatProgress, type ChatRequest, type ChatResult, type Draft } from "@/lib/custom-ai/types";
import { CustomAILaunchPreview } from "./launch-preview";
import { EMPTY_COIN_SETUP, applyCoinSetupPatch, parseCoinSetupPatch, type CoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import { useWallet } from "@/components/wallet-provider";
import { AIRequestError, aiRequest, sameAIRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { ImageReceipt, StoredStudio, StudioState } from "@/lib/custom-ai/studio";
import { loadStudio, restoreStudio, saveStudio, studioBase, studioSnapshot, StudioConflictError, type StudioBase } from "@/lib/custom-ai/studio-sync";
import { createLatestSaveQueue } from "@/lib/custom-ai/latest-save-queue";
import { readDraftCache, writeDraftCache } from "@/lib/custom-ai/draft-cache";
import { conversationWindow } from "@/lib/custom-ai/conversation";
import { safeKnowledgeSources } from "@/lib/custom-ai/knowledge";
import styles from "./workspace.module.css";
import { starterIdeas } from "@/lib/custom-ai/builder-capabilities";
import type { EditTarget } from "@/lib/custom-ai/design-edits";
import { WorkspaceTools } from "./workspace-tools";
import { MessageContent } from "./message-content";
import { CopyButton } from "./copy-button";
import { StreamingReply } from "./streaming-reply";
import { cachedLaunchIntent, intentHasOpenParts, intentMatchesCandidate, type LaunchIntent } from "@/lib/custom-ai/launch-intent";
import { LEGACY_CONVERSATION } from "@/lib/custom-ai/conversation";
import { useChatLibrary } from "./chat-library";
import { useAIReply } from "./use-ai-reply";
import { canMigrateLegacyCache, scopedCacheKeys } from "@/lib/custom-ai/cache-scope";
import { bindPromptHandoff, createPromptHandoff, type PromptHandoff } from "@/lib/custom-ai/prompt-handoff";
import {clearGuestDraft,readGuestDraft,writeGuestDraft} from "@/lib/custom-ai/guest-draft";
import { cachedGeneralProjectView, type GeneralProjectView } from "@/lib/custom-ai/project-view";
import { cachedProjectOverview, overviewFromView, type ProjectOverview } from "@/lib/custom-ai/project-overview";
import { GeneralProjectPreview } from "./general-preview";
import { ProductPlan } from "./product-plan";
import { restoredProductBlueprint, type ProductBlueprint } from "@/lib/custom-ai/product/blueprint";
import { ProjectSource } from "./project-source";
import { builderChain } from "@/lib/custom-ai/execution-routing";
import { CHAT_MESSAGE_LIMIT, pastedMessageFits, workspaceState } from "@/lib/custom-ai/workspace-state";
import { SessionLoading } from "./session-loading";
import { CONTINUE_SAVED_BUILD } from "@/lib/custom-ai/build-command";
import { ChatProgressIndicator } from "./chat-progress";
import { BuildOutcome } from "./build-outcome";
import { ImageAttachments } from "./image-attachments";
import { imageMessageURL, explicitImageMessageURL } from "@/lib/custom-ai/image-message";
import { directLaunchCommand } from "@/lib/custom-ai/launch-command";
import type { CoinDetailsControls } from "./coin-details";
const AuthenticatedChats=lazy(()=>import("./authenticated-chats"));

export function CustomAIWorkspace({ localPreview = false, generalLaunchEnabled = false }: { localPreview?: boolean; generalLaunchEnabled?: boolean }) {
  const wallet = useWallet();
  const owner = localPreview ? "local-preview" : wallet.wallet?.account.toLowerCase() ?? "signed-out";
  const [pendingPrompt,setPendingPrompt]=useState<PromptHandoff>();
  // Reading an owned chat needs the confirmed access session. Waiting for a
  // transaction connector here can hide the chat while its signer reconnects.
  // WalletProvider still enforces that connector for all signing operations.
  const authReady=wallet.authReady!==false;
  useEffect(()=>{if(!localPreview&&authReady&&owner!=="signed-out")clearGuestDraft();},[localPreview,authReady,owner]);
  // Adjust this transient state before committing children for a changed
  // identity. A subsequent account must never mount with the prior prompt.
  if(pendingPrompt&&!localPreview&&authReady){
    if(owner==="signed-out"){
      if(pendingPrompt.principal)setPendingPrompt(undefined);
    }else if(wallet.sessionOwner){
      const bound=bindPromptHandoff(pendingPrompt,wallet.sessionOwner,owner);
      if(bound!==pendingPrompt)setPendingPrompt(bound);
    }
  }
  const acceptPrompt=(id:string)=>setPendingPrompt(current=>current?.id===id?undefined:current);
  const boundPrompt=pendingPrompt?.principal===wallet.sessionOwner&&pendingPrompt?.account===owner?pendingPrompt:undefined;
  const connectPrompt=(content:string)=>{
    writeGuestDraft(content);
    setPendingPrompt(content.trim()?createPromptHandoff(content):undefined);
    wallet.openWallet();
  };
  const invalidatePrompt=(content:string)=>{writeGuestDraft(content);setPendingPrompt(current=>current&&current.content!==content.trim()?undefined:current);};
  const headers: AISessionHeaders = async (): Promise<Record<string, string>> => {
    if (localPreview) return {};
    const access = await wallet.getAccessToken();
    if (!access) { wallet.openWallet(); throw Error("Connect your wallet to continue."); }
    // This API verifies the access session and current linked wallets. Asking
    // the SDK for an optional identity token also refreshes /users/me.
    return { Authorization: `Bearer ${access}` };
  };
  if(!localPreview&&(!authReady||owner!=="signed-out"&&pendingPrompt&&!pendingPrompt.principal))return <SessionLoading onReconnect={wallet.openWallet}/>;
  if(!localPreview&&owner!=="signed-out")return <Suspense fallback={<SessionLoading onReconnect={wallet.openWallet}/>}><AuthenticatedChats account={owner} headers={headers} initialConversationId={boundPrompt?.id}><CustomAISession owner={owner} headers={headers} localPreview={false} generalLaunchEnabled={generalLaunchEnabled} initialPrompt={boundPrompt} onPromptAccepted={acceptPrompt}/></AuthenticatedChats></Suspense>;
  return <CustomAISession key={owner} owner={owner} headers={headers} localPreview={localPreview} generalLaunchEnabled={generalLaunchEnabled} onConnectPrompt={connectPrompt} onGuestInput={invalidatePrompt}/>;
}

function CustomAISession({ owner, headers: sessionHeaders, localPreview, generalLaunchEnabled, initialPrompt, onPromptAccepted, onConnectPrompt, onGuestInput }: { owner: string; headers: AISessionHeaders; localPreview: boolean; generalLaunchEnabled: boolean; initialPrompt?: PromptHandoff; onPromptAccepted?:(id:string)=>void; onConnectPrompt?:(content:string)=>void; onGuestInput?:(content:string)=>void }) {
  const wallet=useWallet(),signedOut=!localPreview&&owner==="signed-out";
  const incomingPrompt=useRef(initialPrompt?{prompt:initialPrompt,accept:onPromptAccepted}:undefined);
  const library=useChatLibrary(),conversationId=library?.id,navigation=library?.navigation;
  const cacheScope=library?.cacheScope;
  const headers: AISessionHeaders=useCallback(async():Promise<Record<string,string>>=>({...await sessionHeaders(),...(cacheScope?{"X-Custom-AI-Cache-Scope":cacheScope}:{})}),[sessionHeaders,cacheScope]);
  type RetryBase = { messages: ChatMessage[]; pendingChange?: string };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [requestSaved,setRequestSaved]=useState(false);
  const [changingCoin, setSwitchingCoin] = useState(false);
  const switchingCoin=changingCoin||Boolean(navigation?.pending);
  const coinTransition = useRef(false);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [inputError, setInputError] = useState("");
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [generalProject,setGeneralProject]=useState<GeneralProjectView>();
  const [sourceRecovery,setSourceRecovery]=useState<ProjectOverview>();
  const sourceId=sourceRecovery?.requestId;
  const latestAttempt=useRef<string|undefined>(undefined);
  const [intent, setIntent] = useState<LaunchIntent>();
  const [productBlueprint,setProductBlueprint]=useState<ProductBlueprint>();
  const [settings, setSettings] = useState(EMPTY_COIN_SETUP);
  const [draftId, setDraftId] = useState<string>();
  const [contextId, setContextId] = useState<string>();
  const [pendingChange, setPendingChange] = useState<string>();
  const [editTarget, setEditTarget] = useState<EditTarget>();
  const [phase, setPhase] = useState<ChatProgress & { type: "phase" }>({ type: "phase", phase: "thinking" });
  const [imageReceipt, setImageReceipt] = useState<ImageReceipt>();
  const [imageBusy,setImageBusy]=useState(false);
  const updateImageReceipt = useCallback((receipt: ImageReceipt | undefined) => {
    setImageReceipt(receipt);
    if (receipt) setNotice("Coin image updated.");
  }, []);
  const coinEditor=useRef<CoinDetailsControls>(null);
  const [restored, setRestored] = useState(false);
  const [launchLocked, setLaunchLocked] = useState(false);
  const [launchCommand,setLaunchCommand]=useState<{id:string;sourceId:string}>();
  const [coinPanelOpen,setCoinPanelOpen]=useState(false);
  const [buildIssue,setBuildIssue]=useState<ChatResult["buildIssue"]>();
  const retry = useRef<ChatRequest | null>(null);
  const retryBase = useRef<RetryBase | undefined>(undefined);
  const [recoveryRequest,setRecoveryRequest]=useState<ChatRequest>();
  const [canReconnect,setCanReconnect]=useState(false);
  const recovered=useRef<string | undefined>(undefined);
  const headersRef = useRef(headers);
  useLayoutEffect(() => { headersRef.current = headers; }, [headers]);
  const remote = useRef({ ready: false, revision: 0, blocked: false, saved: "" });
  const lifetime = useRef<AbortController | null>(null);
  const cachedBase = useRef<StudioBase | undefined>(undefined);
  const saveEpoch = useRef(0);
  const [saveRevision, setSaveRevision] = useState(0);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [conflict, setConflict] = useState<{ server: StoredStudio | null } | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const saveQueue = useRef(createLatestSaveQueue());
  const cacheKeys=cacheScope?scopedCacheKeys(cacheScope,owner,conversationId):undefined;
  const storageKey = cacheKeys?.studio ?? `programmable.custom-ai.studio.v1:${owner}${conversationId&&conversationId!==LEGACY_CONVERSATION?`:chat:${conversationId}`:""}`;
  const legacyStorageKey=cacheKeys?.legacyStudio;
  const [chatRevision, setChatRevision] = useState(0);
  function changeSettings(patch: CoinSetupPatch) { setLaunchCommand(undefined); setSettings(current => applyCoinSetupPatch(current, patch)); }
  const textarea = useRef<HTMLTextAreaElement>(null);
  const workspaceElement = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport, element = workspaceElement.current;
    if (!viewport || !element) return;
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => element.style.setProperty("--custom-ai-viewport", `${viewport.height}px`));
    };
    resize(); viewport.addEventListener("resize", resize);
    return () => { viewport.removeEventListener("resize", resize); cancelAnimationFrame(frame); element.style.removeProperty("--custom-ai-viewport"); };
  }, []);
  const activity = workspaceState({ restored, switching: switchingCoin, busy, stopping, recovering: Boolean(recoveryRequest),
    launchLocked, conflict: Boolean(conflict), saveFailed, online, phase });
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const followLatest = useCallback(() => {
    if (followReply.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, []);
  useEffect(() => {
    const element = transcript.current;
    if (!element) return;
    let frame = 0;
    const resized = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (followReply.current) followLatest();
        else setShowLatest(element.scrollHeight - element.scrollTop - element.clientHeight >= 72);
      });
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resized);
    observer?.observe(element);
    window.visualViewport?.addEventListener("resize", resized);
    return () => { observer?.disconnect(); window.visualViewport?.removeEventListener("resize", resized); cancelAnimationFrame(frame); };
  }, [followLatest]);
  const replyController=useAIReply(()=>headersRef.current(),localPreview,{busy:setBusy,stopping:setStopping,phase:setPhase,partial:setRevealing,error:setError,notice:setNotice});
  const replyRef=useRef(replyController);
  useLayoutEffect(()=>{replyRef.current=replyController;},[replyController]);
  const applyReply=useCallback((request:ChatRequest,data:ChatResult,submitted:ChatMessage[],previousPending?:string)=>{
    retry.current=null;
    setCanReconnect(false);
    setBuildIssue(data.buildIssue);
    const action=data.nextAction;
    setLaunchCommand(action?.kind==="prepare-launch"&&(action.sourceId===request.draftId||action.sourceId===request.id)
      &&data.change!=="blocked"?{id:request.id,sourceId:action.sourceId}:undefined);
    if(action?.kind==="prepare-launch"&&data.change!=="blocked")setCoinPanelOpen(true);
    if(data.draft){setDraft(data.draft);setGeneralProject(undefined);setSourceRecovery(undefined);setDraftId(request.id);}
    if(data.generalProject){
      if(data.generalProject.compiled&&data.generalProject.scenarios?.passed!==false){setGeneralProject(data.generalProject);setDraft(undefined);setDraftId(request.id);setSourceRecovery(undefined);}
      else setSourceRecovery(overviewFromView(request.id,data.generalProject));
    }
    if(data.intent)setIntent(data.intent);
    setProductBlueprint(current=>data.intent
      ?restoredProductBlueprint(data.productBlueprint??current,data.intent,data.setupPatch?.chainId??request.coin?.chainId??1)
      :data.setupPatch?.chainId&&current?.chainId!==data.setupPatch.chainId?undefined:current);
    if(data.change==="applied")setEditTarget(undefined);
    if(data.setupPatch){setSettings(current=>applyCoinSetupPatch(current,data.setupPatch!));setChatRevision(value=>value+1);}
    setContextId(request.id);
    setPendingChange(data.change==="applied"?undefined:request.intent==="compile"?previousPending:data.change==="blocked"?request.messages.at(-1)?.content:previousPending);
    if(request.intent==="compile"){setNotice(data.reply);return;}
    const sources=safeKnowledgeSources(data.sources);
    const completed:ChatMessage[]=[...submitted,{role:"assistant",content:data.reply,...(sources.length?{sources}:{})}];
    const kept=conversationWindow(completed,40,30_000);setMessages(kept);
    if(kept.length<completed.length)setNotice("Earlier messages are summarized. Your agreed rules and current contract are kept.");
  },[]);
  const restoreFailedReply=useCallback((request:ChatRequest,cause:unknown,base:RetryBase,preservedInput?:string)=>{
    if(cause instanceof AIRequestError&&cause.requestState==="failed")retry.current=null;
    setCanReconnect(retry.current!==null);
    if(cause instanceof AIRequestError&&cause.code==="cancelled")setPendingChange(base.pendingChange);
    const nextDraft = textarea.current?.value ?? "";
    // A follow-up typed during generation belongs to the user. Keep it and
    // retain the failed request in the transcript instead of overwriting it.
    const hasNextDraft = request.intent !== "compile" && Boolean(nextDraft);
    setMessages(hasNextDraft ? [...base.messages, request.messages.at(-1)!] : base.messages);
    if(request.intent!=="compile")setInput(current => current || preservedInput || request.messages.at(-1)!.content);
    setSaveRevision(value=>value+1);
    if(!localPreview&&conversationId&&cause instanceof AIRequestError&&cause.requestState==="failed"){
      const signal=lifetime.current?.signal;
      void aiRequest<ProjectOverview>(`/projects?${new URLSearchParams({account:owner,conversation:conversationId,id:request.id,overview:"1"})}`,()=>headersRef.current(),undefined,signal)
        .then(value=>{if(!signal?.aborted&&latestAttempt.current===request.id)setSourceRecovery(value);}).catch(()=>undefined);
    }
  },[localPreview,owner,conversationId]);
  const replySettled=useCallback((focus:boolean)=>{
    setRecoveryRequest(undefined);
    if(focus)requestAnimationFrame(()=>{
      const element=textarea.current;
      if(element&&document.getSelection()?.isCollapsed!==false&&(document.activeElement===document.body||document.activeElement?.closest("form")===element.form))element.focus();
    });
  },[]);

  useEffect(() => {
    let cancelled = false;
    let local: StudioState | null = null;
    let hasServerCopy = false;
    let previousBase: StudioBase | undefined;
    const controller = new AbortController();
    lifetime.current = controller;
    saveEpoch.current += 1;
    remote.current.ready = false;
    let serverRead:Promise<StoredStudio|null>|undefined;
    const readServer=()=>serverRead??=loadStudio(owner,()=>headersRef.current(),controller.signal,conversationId);
    void (owner==="signed-out"?Promise.resolve(undefined):readDraftCache<string>(storageKey)).then(async raw => {
      if(typeof raw!=="string"&&legacyStorageKey){
        const server=await readServer(),legacy=await readDraftCache<string>(legacyStorageKey);
        if(typeof legacy==="string"&&legacy.length<400_000&&canMigrateLegacyCache(JSON.parse(legacy),server)){
          raw=legacy;
          // Old copies remain recoverable. Copy only the image paired with an
          // owned receipt; never adopt an unbound browser blob.
          if(server?.state.image){const blob=await readDraftCache<Blob>(`${legacyStorageKey}:image`);if(blob instanceof Blob)await writeDraftCache(`${storageKey}:image`,blob);}
        }
      }
      if (cancelled) return;
      if(owner==="signed-out"){const saved=readGuestDraft();if(saved)setInput(current=>current||saved);}
      setBuildIssue(undefined);
      if (typeof raw === "string" && raw.length < 400_000) {
        const saved = JSON.parse(raw);
        if (saved.version === 1 && Array.isArray(saved.messages) && saved.messages.length <= 48
          && saved.messages.every((message: ChatMessage) => ["user","assistant"].includes(message.role) && typeof message.content === "string")) {
          const settings = applyCoinSetupPatch(EMPTY_COIN_SETUP, saved.settings);
          const sourceRecovery=cachedProjectOverview(saved.sourceRecovery);
          local = { messages: saved.messages, settings, draftId: saved.draftId, sourceId:sourceRecovery?.requestId, contextId: saved.contextId, pendingChange: saved.pendingChange, image: saved.image, input:saved.input,editTarget:saved.editTarget };
          if (Number.isSafeInteger(saved.syncBase?.revision) && saved.syncBase.revision >= 0 && typeof saved.syncBase.snapshot === "string") previousBase = saved.syncBase;
          cachedBase.current = previousBase;
          setMessages(saved.messages); setSettings(settings); setImageReceipt(saved.image);
          if (typeof saved.input === "string" && saved.input.length <= 8000) setInput(saved.input);
          setContextId(saved.contextId); setPendingChange(saved.pendingChange);
          if (saved.draft && typeof saved.draft.source === "string") setDraft(saved.draft);
          setGeneralProject(cachedGeneralProjectView(saved.generalProject));setSourceRecovery(sourceRecovery);
          setIntent(cachedLaunchIntent(saved.intent) ?? cachedLaunchIntent(saved.draft?.intent));
          setProductBlueprint(restoredProductBlueprint(saved.productBlueprint,cachedLaunchIntent(saved.intent)??cachedLaunchIntent(saved.draft?.intent),settings.chainId));
          if (typeof saved.draftId === "string") setDraftId(saved.draftId);
          retry.current = saved.retry ? parseChatRequest(saved.retry) : null;
          setEditTarget(saved.editTarget ?? retry.current?.editTarget);
          if (retry.current) {
            const message=retry.current.messages.at(-1);
            const hasPending=Boolean(message&&!saved.input&&saved.messages.at(-1)?.role==="user"&&saved.messages.at(-1)?.content===message.content);
            const base:RetryBase=saved.retryBase&&Array.isArray(saved.retryBase.messages)?saved.retryBase
              :{messages:hasPending?saved.messages.slice(0,-1):saved.messages,pendingChange:saved.pendingChange!==message?.content?saved.pendingChange:undefined};
            retryBase.current=base;
            const submitted=retry.current.intent==="compile"?base.messages:[...base.messages,message!];setMessages(submitted);local.messages=submitted;
            setRecoveryRequest(retry.current);
          }
        }
      }
    }).catch(() => { /* An unreadable local cache never authorizes a launch. */ })
      .finally(async () => {
        if (cancelled) return;
        if (!localPreview && owner !== "signed-out") {
          try {
            const server = await readServer();
            if (cancelled) return;
            hasServerCopy=Boolean(server);
            const restored = restoreStudio(local, previousBase, server);
            if(server?.state.contextId === (restored.keepLocal ? local?.contextId : server?.state.contextId))setBuildIssue(server?.buildIssue);
            if (server && !restored.keepLocal) {
              setMessages(server.state.messages); setSettings(server.state.settings);
              setDraftId(server.state.draftId); setDraft(server.draft); setImageReceipt(server.state.image);
              setGeneralProject(server.generalProject);setSourceRecovery(server.sourceRecovery);
              setIntent(server.intent ?? server.draft?.intent);
              setProductBlueprint(restoredProductBlueprint(server.productBlueprint,server.intent??server.draft?.intent,server.state.settings.chainId));
              setContextId(server.state.contextId); setPendingChange(server.state.pendingChange);
              retry.current=null;setRecoveryRequest(undefined);
              setInput(server.state.input??"");setEditTarget(server.state.editTarget);
            }
            if(!restored.conflict&&server?.activeRequest&&server.activeRequest.id!==(restored.keepLocal?local?.contextId:server.state.contextId)&&!retry.current){
              const request=parseChatRequest(server.activeRequest),base={messages:server.state.messages,pendingChange:server.state.pendingChange};
              retry.current=request;retryBase.current=base;setMessages(request.intent==="compile"?base.messages:[...base.messages,request.messages.at(-1)!]);setRecoveryRequest(request);
            }
            remote.current = { ready: true, revision: restored.base.revision, blocked: restored.conflict, saved: restored.base.snapshot };
            if (!restored.conflict) cachedBase.current = restored.base;
            if (restored.conflict) { setConflict({ server }); setNotice("This device has unsaved changes and your online draft is different. Choose which draft to keep."); }
            else setNotice("");
          } catch {
            if (!cancelled) { setSaveFailed(true); setNotice("Your online draft could not be loaded. This device still has its copy."); }
          }
        }
        if (!cancelled) {
          const incoming=incomingPrompt.current;
          if(incoming&&incoming.prompt.id===conversationId&&remote.current.ready&&!remote.current.blocked){
            // Repeating a lost bootstrap may find an already saved input.
            // Keep that copy, and never replace newer private work.
            if(!local&&!hasServerCopy){setInput(incoming.prompt.content);setNotice("Your message is ready to send.");}
            incomingPrompt.current=undefined;
            incoming.accept?.(incoming.prompt.id);
          }
          setRestored(true);
        }
      });
    return () => { cancelled = true; controller.abort(); };
  }, [storageKey, legacyStorageKey, localPreview, owner, restoreRevision,conversationId]);
  useEffect(() => {
    if (!restored || owner === "signed-out") return;
    void writeDraftCache(storageKey, JSON.stringify({ version: 1, messages, input, editTarget, settings, draft, generalProject,sourceRecovery,intent,productBlueprint, draftId, contextId, pendingChange, image: imageReceipt, retry: retry.current,retryBase:retryBase.current,
      // Keep the last shared version so a failed save survives a reload.
      syncBase: cachedBase.current }))
      .catch(() => setNotice("This browser could not save your draft. Keep this tab open."));
  }, [storageKey, owner, restored, messages, input, editTarget, settings, draft, generalProject,sourceRecovery,intent,productBlueprint, draftId, contextId, pendingChange, imageReceipt, saveRevision]);

  useEffect(() => {
    saveQueue.current.invalidate();
    if (!restored || localPreview || busy || switchingCoin || !remote.current.ready || remote.current.blocked) return;
    try { parseCoinSetupPatch(settings); } catch { return; }
    const state: StudioState = { settings, messages, draftId,sourceId, contextId, pendingChange, image: imageReceipt,input,editTarget };
    const snapshot = studioSnapshot(state);
    if (snapshot === remote.current.saved) return;
    const signal = lifetime.current!.signal;
    const epoch = saveEpoch.current;
    const timer = setTimeout(() => {
      void saveQueue.current.enqueue(async () => {
        if (signal.aborted || epoch !== saveEpoch.current || remote.current.blocked || snapshot === remote.current.saved) return;
        try {
          const saved = await saveStudio({ account: owner, conversationId,headers: () => headersRef.current(), state,
            base: { revision: remote.current.revision, snapshot: remote.current.saved }, signal,
            onRetry: () => setNotice("Saved on this device. Reconnecting to save online…") });
          if (signal.aborted) return;
          remote.current.revision = saved.revision;
          remote.current.saved = saved.snapshot;
          cachedBase.current = saved;
          setSaveRevision(value => value + 1); setSaveFailed(false);
          setNotice(current => current.startsWith("Saved on this device.") ? "" : current);
        } catch (cause) {
          if (signal.aborted) return;
          remote.current.blocked = true;
          if (cause instanceof StudioConflictError) setConflict({ server: cause.server });
          else setSaveFailed(true);
          setNotice(cause instanceof Error ? `Saved on this device. ${cause.message}`
            : "Your changes are saved on this device. Reload before editing the online draft again.");
        }
      });
    }, 750);
    return () => clearTimeout(timer);
  }, [restored, localPreview, busy, switchingCoin, settings, messages, draftId,sourceId, contextId, pendingChange, imageReceipt, input,editTarget,owner, saveRevision,conversationId]);

  async function resolveConflict(useOnline: boolean) {
    if (!conflict) return;
    setLaunchCommand(undefined);
    const server = conflict.server;
    if (useOnline) {
      try { await writeDraftCache(`${storageKey}:image`, null); }
      catch { setNotice("This browser could not update the saved image. Keep this tab open."); return; }
      if (lifetime.current?.signal.aborted) return;
      setMessages(server?.state.messages ?? []); setSettings(server?.state.settings ?? EMPTY_COIN_SETUP);
      setDraftId(server?.state.draftId); setDraft(server?.draft); setImageReceipt(server?.state.image); retry.current = null;
      setGeneralProject(server?.generalProject);setSourceRecovery(server?.sourceRecovery);
      setBuildIssue(server?.buildIssue);
      setIntent(server?.intent ?? server?.draft?.intent);
      setProductBlueprint(restoredProductBlueprint(server?.productBlueprint,server?.intent??server?.draft?.intent,server?.state.settings.chainId??settings.chainId));
      setRecoveryRequest(undefined);retryBase.current=undefined;recovered.current=undefined;
      setContextId(server?.state.contextId); setPendingChange(server?.state.pendingChange);
      setInput(server?.state.input??"");setEditTarget(server?.state.editTarget);
      setPreviewRevision(value => value + 1);
    }
    const base = studioBase(server);
    cachedBase.current = base;
    saveEpoch.current += 1;
    remote.current = { ready: true, revision: base.revision, saved: base.snapshot, blocked: false };
    setConflict(null); setNotice(""); setSaveRevision(value => value + 1);
  }


  async function flushCurrent(forSend=false){
    if(localPreview||owner==="signed-out")return;
    if(!remote.current.ready||remote.current.blocked)throw Error("Save or resolve this chat before opening another one.");
    saveQueue.current.invalidate();await saveQueue.current.idle();saveEpoch.current++;
    const active=!forSend&&replyRef.current.isActive()&&retry.current?retryBase.current:undefined;
    const state:StudioState={settings,messages:active?.messages??messages,draftId,sourceId,contextId,pendingChange:active?active.pendingChange:pendingChange,image:imageReceipt,
      input,editTarget};
    const snapshot=studioSnapshot(state);
    if(snapshot===remote.current.saved)return {revision:remote.current.revision,snapshot};
    const saved=await saveStudio({account:owner,conversationId,headers:()=>headersRef.current(),state,base:{revision:remote.current.revision,snapshot:remote.current.saved},signal:lifetime.current!.signal,onRetry:()=>setNotice("Saving your chat…")});
    remote.current.revision=saved.revision;remote.current.saved=saved.snapshot;cachedBase.current=saved;setSaveRevision(v=>v+1);return saved;
  }

  useLayoutEffect(()=>navigation?.registerFlush(()=>flushCurrent()));

  async function startAnother() {
    if (coinTransition.current || busy || recoveryRequest || !restored || launchLocked) return;
    setLaunchCommand(undefined);
    if(navigation){await navigation.newChat();return;}
    coinTransition.current = true; setSwitchingCoin(true);
    try {
    const previous = { messages, settings, draft, generalProject,sourceRecovery,intent,productBlueprint, draftId, contextId, pendingChange, image: imageReceipt, input, editTarget, request: retry.current ?? undefined,retryBase:retryBase.current,
      imageBlob: await readDraftCache<Blob>(`${storageKey}:image`) ?? undefined };
    await writeDraftCache(`${storageKey}:previous`, previous);
    await writeDraftCache(`${storageKey}:image`, null);
    setMessages([]); setSettings(EMPTY_COIN_SETUP); setDraft(undefined);setGeneralProject(undefined);setSourceRecovery(undefined); setIntent(undefined);setProductBlueprint(undefined); setDraftId(undefined);
    setBuildIssue(undefined);
    setContextId(undefined); setPendingChange(undefined); setImageReceipt(undefined); retry.current = null;
    setRecoveryRequest(undefined);retryBase.current=undefined;recovered.current=undefined;
    setEditTarget(undefined);
    setInput(""); setError(""); setNotice(""); setPreviewRevision(value => value + 1);
    textarea.current?.focus();
    } finally { coinTransition.current = false; setSwitchingCoin(false); }
  }
  useLayoutEffect(() => {
    const resize = () => {
      if (!textarea.current) return;
      textarea.current.style.height = "0px";
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 176)}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [input]);
  useLayoutEffect(() => {
    if (!messages.length && !busy && transcript.current) {
      transcript.current.scrollTop = 0;
      followReply.current = true;
      setShowLatest(false);
    } else if (followReply.current && transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
    }
  }, [messages, busy]);

  useEffect(()=>{
    if(!restored||!recoveryRequest||conflict||recovered.current===recoveryRequest.id)return;
    recovered.current=recoveryRequest.id;
    const request=recoveryRequest,base:RetryBase=retryBase.current??{messages:request.messages.slice(0,-1)};
    const submitted=request.intent==="compile"?base.messages:[...base.messages,request.messages.at(-1)!];
    const currentInput=textarea.current?.value??"";
    const preservedInput=request.intent==="compile"?currentInput:currentInput&&currentInput.trim()!==request.messages.at(-1)!.content?currentInput:undefined;
    latestAttempt.current=request.id;
    void replyRef.current.run({request,
      beforeSend:async()=>{setRequestSaved(true);setMessages(submitted);if(!preservedInput&&request.intent!=="compile")setInput("");},
      onResult:data=>applyReply(request,data,submitted,base.pendingChange),
      onFailure:cause=>restoreFailedReply(request,cause,base,preservedInput),
      onSettled:()=>replySettled(false),
    },true);
  },[restored,recoveryRequest,conflict,applyReply,restoreFailedReply,replySettled]);

  const generalBuilt = generalProject?.coinPreparation?.eligible === true && generalProject.compiled && generalProject.sourceReview === "passed" && generalProject.scenarios?.passed === true
    && generalProject.chainId === settings.chainId && generalProject.intentRevision === intent?.revision
    && generalProject.productBlueprintId === productBlueprint?.id && generalLaunchEnabled;
  const feeBuilt = builderChain(settings.chainId).feeCore && (!draft?.program || draft.program.chainId === settings.chainId)
    && draft?.compiled && draft.validation?.status === "passed" && draft.verification?.status === "passed"
    && draft.verification.sourceHash === draft.sourceHash && intentMatchesCandidate(intent, draft);
  const showOutcome = Boolean(!busy && !pendingChange && intent && !intentHasOpenParts(intent) && draftId && (generalBuilt || feeBuilt));
  const openCoinPanel = useCallback(() => {
    setCoinPanelOpen(true);
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 740px)").matches)
        document.getElementById("custom-ai-coin-panel")?.scrollIntoView({block:"start", behavior:"instant"});
    });
  }, []);
  const launchFromMessage = useCallback(() => {
    if (!draftId || !showOutcome || activity.blocked || imageBusy) return;
    openCoinPanel();
    setLaunchCommand({ id: crypto.randomUUID(), sourceId: draftId });
  }, [draftId, showOutcome, activity.blocked, imageBusy, openCoinPanel]);

  async function send(contentOverride?:string) {
    if (replyRef.current.isActive() || coinTransition.current || activity.blocked || imageBusy) return;
    if(contentOverride!==undefined&&input.trim()){
      setNotice("Send or clear your draft message before continuing the saved build.");textarea.current?.focus();return;
    }
    const content = (contentOverride??input).trim();
    if(signedOut){connectCurrentIdea(content);return;}
    if (!content) { textarea.current?.focus(); return; }
    if (input.length > CHAT_MESSAGE_LIMIT) { setInputError("Keep this message within 8,000 characters. Your text is still here."); textarea.current?.focus(); return; }
    setInputError("");
    const launchLocale = directLaunchCommand(content);
    if (launchLocale && showOutcome && !retry.current && !recoveryRequest) {
      followReply.current = true; setShowLatest(false); setInput("");
      setMessages(current => conversationWindow([...current, { role: "user", content }, {
        role: "assistant", content: launchLocale === "de"
          ? "Ich bereite deinen geprüften Hook für den Launch vor. Fehlende Coin-Details kannst du direkt ergänzen; die Transaktion bestätigst du in deiner Wallet."
          : "I’m preparing your checked hook for launch. You can fill in any missing coin details here, then confirm the transaction in your wallet.",
      }], 40, 30_000));
      launchFromMessage();
      return;
    }
    const imageURL = imageMessageURL(content);
    if (imageURL) {
      const updated = await attachImageURL(imageURL);
      if (updated) {
        setInput(current => current.trim() === content ? "" : current);
        setMessages(current => [...current, {role:"user",content}, {role:"assistant",content:/\b(?:bild|nimm|nutze|verwende|ändere|ersetze|bitte)\b/iu.test(content) ? "Das neue Bild ist gespeichert. Deine Regeln bleiben unverändert." : "The new image is saved. Your rules are unchanged."}]);
      } else setInputError("That image could not be loaded. Use a direct image link or upload the file. Your message is still here.");
      return;
    }
    const requestedImage=explicitImageMessageURL(content);
    if(requestedImage&&!await attachImageURL(requestedImage)){
      setInputError("That image could not be loaded. Use a direct image link or upload the file. Your message is still here.");
      return;
    }
    const base:RetryBase={messages,pendingChange};
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    const payload={...(conversationId?{conversation:{id:conversationId,account:owner,revision:retry.current?.conversation?.revision??remote.current.revision}}:{}),intent:"chat" as const,messages:conversationWindow(next),coin:settings,...(draftId?{draftId}:{}),...(contextId?{contextId}:{}),...(editTarget?{editTarget}:{})};
    const previousRequest=retry.current,candidate:ChatRequest={...payload,id:previousRequest?.id??crypto.randomUUID()};
    const request:ChatRequest=previousRequest&&sameAIRequest(previousRequest,candidate)?previousRequest:previousRequest?{...payload,id:crypto.randomUUID()}:candidate;
    const previousRetryBase=retryBase.current;
    const focus=document.activeElement===textarea.current||document.activeElement?.closest("form")===textarea.current?.form;
    await replyRef.current.run({request,
      beforeSend:async()=>{
        setLaunchCommand(undefined);
        setRequestSaved(false);followReply.current=true;setShowLatest(false);setMessages(next);setInput("");setPendingChange(content);
        latestAttempt.current=request.id;
        if(conversationId&&request!==previousRequest){const saved=await flushCurrent(true);request.conversation={id:conversationId,account:owner,revision:saved!.revision};}
        retry.current=request;retryBase.current=base;
        try{
          await writeDraftCache(storageKey,JSON.stringify({version:1,messages:next,input:"",editTarget,settings,draft,generalProject,sourceRecovery,intent,productBlueprint,draftId,contextId,pendingChange:content,image:imageReceipt,
            retry:request,retryBase:base,syncBase:cachedBase.current}));
          setRequestSaved(true);
        }catch{retry.current=previousRequest;retryBase.current=previousRetryBase;throw Error("This browser could not save the new request. Your previous saved request is kept.");}
      },
      onResult:data=>applyReply(request,data,next,base.pendingChange),
      onFailure:cause=>restoreFailedReply(request,cause,base),
      onSettled:()=>replySettled(focus),
    });
  }

  function connectCurrentIdea(content=input.trim()) {
    try { onConnectPrompt?.(content); setError(""); setNotice("Complete the wallet connection. Your idea stays here."); }
    catch(cause) { setError(cause instanceof Error?cause.message:"Your message could not be prepared."); }
  }

  async function retryCompilation(source:ProjectOverview){
    if(localPreview||!conversationId||replyRef.current.isActive()||recoveryRequest||coinTransition.current||!restored||launchLocked||saveFailed||conflict)return;
    if(settings.chainId!==source.chainId){setError("Keep this source on its saved network or prepare a new revision.");return;}
    const base:RetryBase={messages,pendingChange},previousRequest=retry.current,previousBase=retryBase.current;
    const request:ChatRequest={id:crypto.randomUUID(),intent:"compile",messages:[],compilationOf:{id:source.requestId,projectHash:source.projectHash},
      conversation:{id:conversationId,account:owner,revision:remote.current.revision},coin:settings,...(draftId?{draftId}:{}),...(contextId?{contextId}:{})};
    await replyRef.current.run({request,beforeSend:async()=>{
      setRequestSaved(false);latestAttempt.current=request.id;
      const saved=await flushCurrent(true);request.conversation!.revision=saved!.revision;
      retry.current=request;retryBase.current=base;
      try{
        await writeDraftCache(storageKey,JSON.stringify({version:1,messages,input,editTarget,settings,draft,generalProject,sourceRecovery,intent,productBlueprint,draftId,contextId,pendingChange,image:imageReceipt,
          retry:request,retryBase:base,syncBase:cachedBase.current}));setRequestSaved(true);
      }catch{retry.current=previousRequest;retryBase.current=previousBase;throw Error("This browser could not save the build request. Your source is kept.");}
    },onResult:data=>applyReply(request,data,base.messages,base.pendingChange),onFailure:cause=>restoreFailedReply(request,cause,base),onSettled:()=>replySettled(false)});
  }

  async function editSavedSource(source:ProjectOverview){
    if(busy||recoveryRequest||coinTransition.current||!restored||launchLocked||saveFailed||conflict)return;
    if(source.chainId!==settings.chainId||source.intentRevision!==intent?.revision){setError("Your design or network changed. Build the current design before editing its source.");return;}
    coinTransition.current=true;setSwitchingCoin(true);setError("");
    try{
      const job=await aiRequest<{result?:ChatResult}>(`?id=${encodeURIComponent(source.requestId)}`,()=>headersRef.current(),undefined,lifetime.current!.signal);
      if(!job.result?.generalProject||job.result.generalProject.projectHash!==source.projectHash||job.result.intent?.revision!==source.intentRevision)throw Error("This source needs its saved build result before it can be edited here.");
      setDraft(undefined);setGeneralProject(job.result.generalProject);setDraftId(source.requestId);setSourceRecovery(undefined);
      setEditTarget(undefined);setNotice("Editing your saved source.");textarea.current?.focus();
    }catch(cause){if(!lifetime.current?.signal.aborted)setError(cause instanceof Error?cause.message:"The saved source could not be selected.");}
    finally{coinTransition.current=false;setSwitchingCoin(false);}
  }

  const productPanel=productBlueprint&&productBlueprint.chainId===settings.chainId&&productBlueprint.intentRevision===intent?.revision&&<ProductPlan blueprint={productBlueprint} implementation={generalProject?.implementation}/>;
  const sourcePanel=sourceRecovery&&<ProjectSource key={sourceRecovery.requestId} source={sourceRecovery} chainId={settings.chainId} account={owner} conversationId={conversationId} headers={headers}
    disabled={busy||Boolean(recoveryRequest)||switchingCoin||!restored||launchLocked||saveFailed||Boolean(conflict)} recovery
    onCompile={source=>void retryCompilation(source)} onEdit={source=>void editSavedSource(source)}/>;

  const attachImage = async (file: File) => {
    if(signedOut){setInputError("Connect your wallet before adding a coin image.");return;}
    if (activity.blocked || imageBusy) return;
    setLaunchCommand(undefined);
    if (await coinEditor.current?.chooseImage(file)) setNotice("Coin image updated.");
    else openCoinPanel();
  };
  const attachImageURL = async (url: string) => {
    if (activity.blocked || imageBusy) return false;
    setLaunchCommand(undefined);
    const updated = await coinEditor.current?.imageFromURL(url) ?? false;
    if (updated) setNotice("Coin image updated.");
    return updated;
  };

  return <div ref={workspaceElement} className={styles.workspace}>
    <div className={styles.studio} data-guest={signedOut||undefined}>
    <section className={styles.conversation} aria-label="Build your coin" data-chat-state={signedOut?"wallet-required":activity.id}
      data-build-issue={buildIssue?`${buildIssue.stage}:${buildIssue.code}`:undefined}
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={event => { const file = event.dataTransfer.files[0]; if (file) { event.preventDefault(); void attachImage(file); } }}>
      <WorkspaceTools name={settings.name}
        access={!localPreview&&!signedOut&&<button type="button" className={styles.walletAccess} aria-haspopup="dialog"
          aria-label={`Connected wallet ${owner}. Manage wallet`}
          disabled={launchLocked||switchingCoin||!restored} onClick={()=>wallet.openWallet()}>
          <Wallet size={16} aria-hidden="true"/>{`${owner.slice(0,6)}…${owner.slice(-4)}`}
        </button>}
        navigation={navigation?.tools(launchLocked||!restored||switchingCoin||busy&&!requestSaved)} />
      <div ref={transcript} className={styles.transcript} role="log" aria-label="Conversation" aria-busy={busy}
        aria-live="polite" aria-relevant="additions" onScroll={event => {
          const element = event.currentTarget;
          followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
          setShowLatest(!followReply.current);
        }}>
        {!messages.length && !busy && <div className={styles.empty}>
          {signedOut ? <div className={styles.walletWelcome}>
            <span className={styles.srOnly}>Custom AI</span>
            <h2>What are we building?</h2>
            <p>Hey, connect your wallet and tell me your idea. I’ll help you build it.</p>
            <button type="button" className={styles.connectWallet} aria-haspopup="dialog" onClick={()=>connectCurrentIdea()}>
              <Wallet size={18} aria-hidden="true" />Connect wallet
            </button>
          </div> : <>
            <h2>{draft||generalProject ? "Keep shaping your coin" : "What are we building?"}</h2>
            <p>{draft||generalProject ? "Your rules are saved. What would you like to change?" : "Tell me your idea. We’ll shape it here, then you can launch it."}</p>
          </>}
          <div className={styles.starterIdeas} aria-label="Ideas to get started">
            {starterIdeas.map(idea => <button type="button" key={idea.title} disabled={!restored || switchingCoin || launchLocked}
              onClick={() => { setInput(idea.prompt); onGuestInput?.(idea.prompt); textarea.current?.focus(); }}>{idea.title}<ArrowUp size={15} aria-hidden="true" /></button>)}
          </div>
        </div>}
        {messages.map((message, index) => <article className={styles.message} key={index} data-role={message.role}>
          <span className={styles.srOnly}>{message.role === "user" ? "You" : "Custom AI"}</span>
          <MessageContent content={message.content} assistant={message.role === "assistant"} />
          {message.role === "assistant" && message.sources?.length ? <ul className={styles.sources} aria-label="Sources">
            {safeKnowledgeSources(message.sources).map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}
          </ul> : null}
          {message.role === "assistant" && <CopyButton compact label="Copy answer" value={message.content} />}
        </article>)}
        {showOutcome && intent && <BuildOutcome name={settings.name} symbol={settings.symbol} network={builderChain(settings.chainId).name}
          rules={intent.requirements} onLaunch={launchFromMessage} disabled={activity.blocked || imageBusy} />}
        {revealing !== null && <StreamingReply text={revealing} onAdvance={followLatest} />}
      </div>
      {showLatest && messages.length > 0 && <button type="button" className={styles.jumpToLatest} onClick={() => {
        followReply.current = true; followLatest(); setShowLatest(false);
      }}>Latest message<ArrowDown size={14} aria-hidden="true" /></button>}
      <ChatProgressIndicator key={imageBusy ? "image" : activity.id} label={imageBusy ? "Saving your image…" : activity.blocked ? activity.message : notice || (signedOut?"Connect your wallet to start building. Your idea stays here.":activity.message)}
        working={busy || imageBusy || Boolean(recoveryRequest) || switchingCoin || !restored} visible={imageBusy || activity.blocked || Boolean(notice)} />
      {notice && activity.blocked && notice !== activity.message && <p className={styles.notice}>{notice}</p>}
      {conflict && <div className={styles.saveActions}>
        <button type="button" disabled={busy} onClick={() => resolveConflict(false)}>Keep this device’s draft</button>
        <button type="button" disabled={busy} onClick={() => resolveConflict(true)}>Use online draft</button>
      </div>}
      {saveFailed && !conflict && <div className={styles.saveActions}>
        <button type="button" disabled={busy} onClick={() => {
          if (!remote.current.ready) { setRestored(false); setSaveFailed(false); setConflict(null); setRestoreRevision(value => value + 1); }
          else { remote.current.blocked = false; setSaveFailed(false); setSaveRevision(value => value + 1); }
        }}>Retry saving</button>
      </div>}
      {error && <p className={styles.error} role="alert" id="custom-ai-error">{error}</p>}
      {error&&canReconnect&&!busy&&<button type="button" className={styles.textButton} onClick={()=>{
        const request=retry.current;if(!request)return;recovered.current=undefined;setRecoveryRequest(request);
      }}>Reconnect to saved reply</button>}
      {buildIssue&&!busy&&<section className={styles.buildRecovery} aria-label="Continue saved build">
        <p>Your rules are saved. Continue this build from its saved work.</p>
        <button type="button" className={styles.textButton} disabled={activity.blocked||Boolean(input.trim())}
          onClick={()=>void send(CONTINUE_SAVED_BUILD)}>Continue building</button>
        {input.trim()&&<small>Send or clear your draft message first.</small>}
      </section>}

      {editTarget && <div className={styles.editScope} role="status" id="custom-ai-edit-scope">
        <span>Editing: {(intent?.requirements ?? draft?.composable?.spec.requirements)?.find(rule => rule.id === editTarget.requirementId)?.text ?? "Selected rule"}</span>
        <button type="button" aria-label="Edit the whole design instead" disabled={busy || Boolean(recoveryRequest) || switchingCoin || !restored || launchLocked} onClick={() => {setEditTarget(undefined);textarea.current?.focus();}}><X size={16} aria-hidden="true" /></button>
      </div>}
      {inputError && <p id="custom-ai-input-error" className={styles.error} role="alert">{inputError}</p>}
      <form className={styles.composer} aria-label="Message Custom AI" onSubmit={event => { event.preventDefault(); void send(); }}
        >
        {!signedOut&&<ImageAttachments disabled={activity.blocked || imageBusy} onChoose={() => { setLaunchCommand(undefined); coinEditor.current?.focus("image"); }} onURL={attachImageURL} />}
        <label htmlFor="custom-ai-message" className={styles.srOnly}>{editTarget ? "Describe your change to this rule" : "Describe your coin or ask a question"}</label>
        <textarea ref={textarea} id="custom-ai-message" name="message" autoComplete="off" value={input} maxLength={CHAT_MESSAGE_LIMIT} readOnly={switchingCoin || !restored || launchLocked}
          aria-invalid={Boolean(inputError)} aria-describedby={["custom-ai-help", "custom-ai-state", error && "custom-ai-error", inputError && "custom-ai-input-error", editTarget && "custom-ai-edit-scope"].filter(Boolean).join(" ")}
          placeholder={editTarget ? "What would you like to change?" : "Describe your idea…"} rows={1} onChange={event => { setLaunchCommand(undefined); setInput(event.target.value); onGuestInput?.(event.target.value); setInputError(""); }}
          onPaste={event => {
            const image = [...event.clipboardData.files].find(file => file.type.startsWith("image/"));
            if (image) { event.preventDefault(); void attachImage(image); return; }
            const element = event.currentTarget;
            if (!pastedMessageFits(input, event.clipboardData.getData("text/plain"), element.selectionStart, element.selectionEnd)) {
              event.preventDefault(); setInputError("That paste would exceed 8,000 characters. Shorten it and paste again; your current message is unchanged.");
            }
          }}
          onKeyDown={event => {
            if(event.key === "Escape" && editTarget && !busy && !recoveryRequest && !switchingCoin && restored && !launchLocked) {event.preventDefault();setEditTarget(undefined);return;}
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); void send();
            }
          }} />
        {busy ? <button type="button" className={styles.send} disabled={stopping}
          aria-label="Stop response" onClick={event => {
            event.preventDefault();
            void replyRef.current.stop();
          }}>
          <Square size={15} strokeWidth={1.75} aria-hidden="true" />
        </button> : <button type="submit" className={styles.send} disabled={activity.blocked || imageBusy} data-empty={!input.trim()} aria-label={signedOut?"Connect wallet to start building":"Send message"} aria-describedby="custom-ai-state">
          <ArrowUp size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>}
      </form>
      {input.length >= 7_000 && <p className={styles.inputLimit}>{input.length.toLocaleString("en-US")} / 8,000 characters</p>}
      <p className={styles.srOnly} id="custom-ai-help">Enter to send. Shift + Enter for a new line. {editTarget && "Escape returns to the whole design and keeps your message. "}Messages are processed by the configured AI provider.</p>
    </section>

    {!signedOut&&<div className={styles.coinFrame} data-expanded={coinPanelOpen}>
    <button type="button" className={styles.coinPanelToggle} aria-label="Coin preview and details" aria-expanded={coinPanelOpen} aria-controls="custom-ai-coin-panel"
      onClick={() => setCoinPanelOpen(current => !current)}>
      <span><strong>{settings.name || "Your coin"}</strong><small>{settings.symbol ? `$${settings.symbol} · ` : ""}{builderChain(settings.chainId).name}</small></span>
      <ChevronDown size={18} aria-hidden="true" />
    </button>
    <div id="custom-ai-coin-panel" className={styles.coinFrameBody}>
    {!restored?<aside className={styles.coinPanel} aria-label="Coin preview and details" aria-busy="true"><p role="status">Loading your coin…</p></aside>:generalProject||!builderChain(settings.chainId).feeCore?<GeneralProjectPreview key={previewRevision} project={generalProject} intent={intent} draftId={draftId} account={owner} conversationId={conversationId}
      headers={headers} disabled={busy||Boolean(recoveryRequest)||switchingCoin||!restored} settings={settings} onChange={changeSettings} chatRevision={chatRevision}
      localPreview={localPreview} cacheKey={storageKey} imageReceipt={imageReceipt} onImageReceipt={updateImageReceipt}
      editorControls={coinEditor} onImageBusy={setImageBusy}
      generalLaunchEnabled={generalLaunchEnabled} pendingChange={pendingChange} flush={()=>flushCurrent(true)} onLaunchLocked={setLaunchLocked}
      launchCommand={launchCommand}
      onEditRule={requirementId=>{if(generalProject&&!busy&&!launchLocked){setEditTarget({sourceHash:generalProject.projectHash.slice(7),requirementId});textarea.current?.focus();}}}>
      {productPanel}{sourcePanel}
    </GeneralProjectPreview>:<CustomAILaunchPreview key={previewRevision} draft={draft} intent={intent} disabled={busy || Boolean(recoveryRequest) || switchingCoin || !restored} settings={settings} chatRevision={chatRevision} onChange={changeSettings}
      draftId={draftId} headers={headers} localPreview={localPreview} cacheKey={storageKey} onLaunchLocked={setLaunchLocked}
      imageReceipt={imageReceipt} onImageReceipt={updateImageReceipt} pendingChange={busy ? undefined : pendingChange}
      editorControls={coinEditor} onImageBusy={setImageBusy}
      launchCommand={launchCommand}
      onKeepRules={() => {
        setIntent(draft?.intent);
        setProductBlueprint(current=>restoredProductBlueprint(current,draft?.intent,settings.chainId));
        setPendingChange(undefined); setContextId(draftId); setEditTarget(undefined);
        retry.current = null; setNotice("Keeping the previous rules.");
      }}
      onEditRule={requirementId => {
        if (!draft || busy || launchLocked) return;
        setEditTarget({ sourceHash: draft.sourceHash, requirementId });
        textarea.current?.focus();
      }}
      onStartAnother={() => { void startAnother().catch(() => setError("The previous coin could not be saved on this device. Try again.")); }}>{productPanel}{sourcePanel}</CustomAILaunchPreview>}
    </div>
    </div>}
    </div>
  </div>;
}
