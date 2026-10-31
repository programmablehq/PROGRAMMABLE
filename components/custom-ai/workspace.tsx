"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Square, X } from "lucide-react";
import { parseChatRequest, type AIUsage, type ChatMessage, type ChatProgress, type ChatRequest, type ChatResult, type Draft } from "@/lib/custom-ai/types";
import { CustomAILaunchPreview } from "./launch-preview";
import { EMPTY_COIN_SETUP, applyCoinSetupPatch, parseCoinSetupPatch, type CoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import { useWallet } from "@/components/wallet-provider";
import { AIRequestError, aiRequest, sameAIRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { ImageReceipt, StoredStudio, StudioState } from "@/lib/custom-ai/studio";
import { loadStudio, restoreStudio, saveStudio, studioBase, studioSnapshot, StudioConflictError, type StudioBase } from "@/lib/custom-ai/studio-sync";
import { readDraftCache, writeDraftCache } from "@/lib/custom-ai/draft-cache";
import { conversationWindow } from "@/lib/custom-ai/conversation";
import { safeKnowledgeSources } from "@/lib/custom-ai/knowledge";
import styles from "./workspace.module.css";
import { DraftVersions } from "./draft-versions";
import { RequestInsights } from "./request-insights";
import { starterIdeas } from "@/lib/custom-ai/builder-capabilities";
import type { EditTarget } from "@/lib/custom-ai/design-edits";
import { WorkspaceTools } from "./workspace-tools";
import { MessageContent } from "./message-content";
import { CopyButton } from "./copy-button";
import { StreamingReply } from "./streaming-reply";
import { cachedLaunchIntent, type LaunchIntent } from "@/lib/custom-ai/launch-intent";
import { LEGACY_CONVERSATION } from "@/lib/custom-ai/conversation";
import { ChatLibrary, useChatLibrary } from "./chat-library";
import { useAIReply } from "./use-ai-reply";

export function CustomAIWorkspace({ localPreview = false }: { localPreview?: boolean }) {
  const wallet = useWallet();
  const owner = localPreview ? "local-preview" : wallet.wallet?.account.toLowerCase() ?? "signed-out";
  const headers: AISessionHeaders = async () => {
    if (localPreview) return {};
    const access = await wallet.getAccessToken();
    if (!access) { wallet.openWallet(); throw Error("Connect your wallet to continue."); }
    const identity = await wallet.getIdentityToken();
    return { Authorization: `Bearer ${access}`, ...(identity ? { "X-Privy-Identity-Token": identity } : {}) };
  };
  if(!localPreview&&owner!=="signed-out")return <ChatLibrary key={owner} account={owner} headers={headers}><CustomAISession owner={owner} headers={headers} localPreview={false}/></ChatLibrary>;
  return <CustomAISession key={owner} owner={owner} headers={headers} localPreview={localPreview} />;
}

function CustomAISession({ owner, headers, localPreview }: { owner: string; headers: AISessionHeaders; localPreview: boolean }) {
  const library=useChatLibrary(),conversationId=library?.id,navigation=library?.navigation;
  type RetryBase = { messages: ChatMessage[]; pendingChange?: string };
  type PreviousCoin = StudioState & { draft?: Draft; intent?: LaunchIntent; imageBlob?: Blob; input?: string; editTarget?: EditTarget; request?: ChatRequest; retryBase?: RetryBase };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [requestSaved,setRequestSaved]=useState(false);
  const [changingCoin, setSwitchingCoin] = useState(false);
  const switchingCoin=changingCoin||Boolean(navigation?.pending);
  const coinTransition = useRef(false);
  const [metricsRevision, setMetricsRevision] = useState(0);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [intent, setIntent] = useState<LaunchIntent>();
  const [settings, setSettings] = useState(EMPTY_COIN_SETUP);
  const [draftId, setDraftId] = useState<string>();
  const [contextId, setContextId] = useState<string>();
  const [pendingChange, setPendingChange] = useState<string>();
  const [editTarget, setEditTarget] = useState<EditTarget>();
  const [usage, setUsage] = useState<AIUsage>();
  const [previousCoin, setPreviousCoin] = useState<PreviousCoin>();
  const [phase, setPhase] = useState<ChatProgress & { type: "phase" }>({ type: "phase", phase: "thinking" });
  const [imageReceipt, setImageReceipt] = useState<ImageReceipt>();
  const [restored, setRestored] = useState(false);
  const [launchLocked, setLaunchLocked] = useState(false);
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
  const saveQueue = useRef(Promise.resolve());
  const storageKey = `programmable.custom-ai.studio.v1:${owner}${conversationId&&conversationId!==LEGACY_CONVERSATION?`:chat:${conversationId}`:""}`;
  const [chatRevision, setChatRevision] = useState(0);
  function changeSettings(patch: CoinSetupPatch) { setSettings(current => applyCoinSetupPatch(current, patch)); }
  const textarea = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const followLatest = useCallback(() => {
    if (followReply.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, []);
  const replyController=useAIReply(()=>headersRef.current(),localPreview,{busy:setBusy,stopping:setStopping,phase:setPhase,partial:setRevealing,error:setError,notice:setNotice});
  const replyRef=useRef(replyController);
  useLayoutEffect(()=>{replyRef.current=replyController;},[replyController]);
  const applyReply=useCallback((request:ChatRequest,data:ChatResult,submitted:ChatMessage[],previousPending?:string)=>{
    retry.current=null;
    setCanReconnect(false);
    if(data.draft){setDraft(data.draft);setDraftId(request.id);}
    if(data.intent)setIntent(data.intent);
    if(data.change==="applied")setEditTarget(undefined);
    if(data.setupPatch){setSettings(current=>applyCoinSetupPatch(current,data.setupPatch!));setChatRevision(value=>value+1);}
    setContextId(request.id);
    setPendingChange(data.change==="applied"?undefined:data.change==="blocked"?request.messages.at(-1)!.content:previousPending);
    const sources=safeKnowledgeSources(data.sources);
    const completed:ChatMessage[]=[...submitted,{role:"assistant",content:data.reply,...(sources.length?{sources}:{})}];
    const kept=conversationWindow(completed,40,30_000);setMessages(kept);
    if(kept.length<completed.length)setNotice("Earlier messages are summarized. Your agreed rules and current contract are kept.");
  },[]);
  const restoreFailedReply=useCallback((request:ChatRequest,cause:unknown,base:RetryBase,preservedInput?:string)=>{
    if(cause instanceof AIRequestError&&cause.requestState==="failed")retry.current=null;
    setCanReconnect(retry.current!==null);
    if(cause instanceof AIRequestError&&cause.code==="cancelled")setPendingChange(base.pendingChange);
    setMessages(base.messages);setInput(preservedInput??request.messages.at(-1)!.content);setSaveRevision(value=>value+1);
  },[]);
  const replySettled=useCallback((focus:boolean)=>{
    setRecoveryRequest(undefined);setMetricsRevision(value=>value+1);
    if(focus)requestAnimationFrame(()=>{
      const element=textarea.current;
      if(element&&document.getSelection()?.isCollapsed!==false&&(document.activeElement===document.body||document.activeElement?.closest("form")===element.form))element.focus();
    });
  },[]);

  useEffect(() => {
    let cancelled = false;
    let local: StudioState | null = null;
    let previousBase: StudioBase | undefined;
    const controller = new AbortController();
    lifetime.current = controller;
    saveEpoch.current += 1;
    remote.current.ready = false;
    void readDraftCache<string>(storageKey).then(raw => {
      if (cancelled) return;
      if (typeof raw === "string" && raw.length < 400_000) {
        const saved = JSON.parse(raw);
        if (saved.version === 1 && Array.isArray(saved.messages) && saved.messages.length <= 48
          && saved.messages.every((message: ChatMessage) => ["user","assistant"].includes(message.role) && typeof message.content === "string")) {
          const settings = applyCoinSetupPatch(EMPTY_COIN_SETUP, saved.settings);
          local = { messages: saved.messages, settings, draftId: saved.draftId, contextId: saved.contextId, pendingChange: saved.pendingChange, image: saved.image, input:saved.input,editTarget:saved.editTarget };
          if (Number.isSafeInteger(saved.syncBase?.revision) && saved.syncBase.revision >= 0 && typeof saved.syncBase.snapshot === "string") previousBase = saved.syncBase;
          cachedBase.current = previousBase;
          setMessages(saved.messages); setSettings(settings); setImageReceipt(saved.image);
          if (typeof saved.input === "string" && saved.input.length <= 8000) setInput(saved.input);
          setContextId(saved.contextId); setPendingChange(saved.pendingChange);
          if (saved.draft && typeof saved.draft.source === "string") setDraft(saved.draft);
          setIntent(cachedLaunchIntent(saved.intent) ?? cachedLaunchIntent(saved.draft?.intent));
          if (typeof saved.draftId === "string") setDraftId(saved.draftId);
          retry.current = saved.retry ? parseChatRequest(saved.retry) : null;
          setEditTarget(saved.editTarget ?? retry.current?.editTarget);
          if (retry.current) {
            const message=retry.current.messages.at(-1)!;
            const hasPending=!saved.input&&saved.messages.at(-1)?.role==="user"&&saved.messages.at(-1)?.content===message.content;
            const base:RetryBase=saved.retryBase&&Array.isArray(saved.retryBase.messages)?saved.retryBase
              :{messages:hasPending?saved.messages.slice(0,-1):saved.messages,pendingChange:saved.pendingChange!==message.content?saved.pendingChange:undefined};
            retryBase.current=base;
            const submitted=[...base.messages,message];setMessages(submitted);local.messages=submitted;
            setRecoveryRequest(retry.current);
          }
        }
      }
    }).catch(() => { /* An unreadable local cache never authorizes a launch. */ })
      .finally(async () => {
        if (cancelled) return;
        if (!localPreview && owner !== "signed-out") {
          try {
            const server = await loadStudio(owner, () => headersRef.current(), controller.signal,conversationId);
            if (cancelled) return;
            const restored = restoreStudio(local, previousBase, server);
            if (server && !restored.keepLocal) {
              setMessages(server.state.messages); setSettings(server.state.settings);
              setDraftId(server.state.draftId); setDraft(server.draft); setImageReceipt(server.state.image);
              setIntent(server.intent ?? server.draft?.intent);
              setContextId(server.state.contextId); setPendingChange(server.state.pendingChange);
              retry.current=null;setRecoveryRequest(undefined);
              setInput(server.state.input??"");setEditTarget(server.state.editTarget);
            }
            if(!restored.conflict&&server?.activeRequest&&server.activeRequest.id!==(restored.keepLocal?local?.contextId:server.state.contextId)&&!retry.current){
              const request=parseChatRequest(server.activeRequest),base={messages:server.state.messages,pendingChange:server.state.pendingChange};
              retry.current=request;retryBase.current=base;setMessages([...base.messages,request.messages.at(-1)!]);setRecoveryRequest(request);
            }
            remote.current = { ready: true, revision: restored.base.revision, blocked: restored.conflict, saved: restored.base.snapshot };
            if (!restored.conflict) cachedBase.current = restored.base;
            if (restored.conflict) { setConflict({ server }); setNotice("This device has unsaved changes and your online draft is different. Choose which draft to keep."); }
            else setNotice("");
          } catch {
            if (!cancelled) { setSaveFailed(true); setNotice("Your online draft could not be loaded. This device still has its copy."); }
          }
        }
        if (!cancelled) setRestored(true);
      });
    return () => { cancelled = true; controller.abort(); };
  }, [storageKey, localPreview, owner, restoreRevision,conversationId]);
  useEffect(() => {
    if (!restored || owner === "signed-out") return;
    void writeDraftCache(storageKey, JSON.stringify({ version: 1, messages, input, editTarget, settings, draft, intent, draftId, contextId, pendingChange, image: imageReceipt, retry: retry.current,retryBase:retryBase.current,
      // Keep the last shared version so a failed save survives a reload.
      syncBase: cachedBase.current }))
      .catch(() => setNotice("This browser could not save your draft. Keep this tab open."));
  }, [storageKey, owner, restored, messages, input, editTarget, settings, draft, intent, draftId, contextId, pendingChange, imageReceipt, saveRevision]);

  useEffect(() => {
    if (!restored || localPreview || busy || switchingCoin || !remote.current.ready || remote.current.blocked) return;
    try { parseCoinSetupPatch(settings); } catch { return; }
    const state: StudioState = { settings, messages, draftId, contextId, pendingChange, image: imageReceipt,input,editTarget };
    const snapshot = studioSnapshot(state);
    if (snapshot === remote.current.saved) return;
    const signal = lifetime.current!.signal;
    const epoch = saveEpoch.current;
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
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
  }, [restored, localPreview, busy, switchingCoin, settings, messages, draftId, contextId, pendingChange, imageReceipt, input,editTarget,owner, saveRevision,conversationId]);

  async function resolveConflict(useOnline: boolean) {
    if (!conflict) return;
    const server = conflict.server;
    if (useOnline) {
      try { await writeDraftCache(`${storageKey}:image`, null); }
      catch { setNotice("This browser could not update the saved image. Keep this tab open."); return; }
      if (lifetime.current?.signal.aborted) return;
      setMessages(server?.state.messages ?? []); setSettings(server?.state.settings ?? EMPTY_COIN_SETUP);
      setDraftId(server?.state.draftId); setDraft(server?.draft); setImageReceipt(server?.state.image); retry.current = null;
      setIntent(server?.intent ?? server?.draft?.intent);
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

  useEffect(() => {
    let active = true;
    void readDraftCache<PreviousCoin>(`${storageKey}:previous`).then(value => {
      if (active && value && Array.isArray(value.messages) && value.settings) setPreviousCoin(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [storageKey]);
  useEffect(() => {
    if (localPreview || owner === "signed-out" || busy) return;
    const controller = new AbortController();
    const refresh = () => void aiRequest<AIUsage>("/usage", () => headersRef.current(), undefined, controller.signal)
      .then(setUsage).catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [owner, localPreview, busy]);

  async function flushCurrent(forSend=false){
    if(localPreview||owner==="signed-out")return;
    if(!remote.current.ready||remote.current.blocked)throw Error("Save or resolve this chat before opening another one.");
    await saveQueue.current;saveEpoch.current++;
    const active=!forSend&&replyRef.current.isActive()&&retry.current?retryBase.current:undefined;
    const state:StudioState={settings,messages:active?.messages??messages,draftId,contextId,pendingChange:active?active.pendingChange:pendingChange,image:imageReceipt,
      input:active?retry.current?.messages.at(-1)?.content??input:input,editTarget};
    const snapshot=studioSnapshot(state);
    if(snapshot===remote.current.saved)return {revision:remote.current.revision,snapshot};
    const saved=await saveStudio({account:owner,conversationId,headers:()=>headersRef.current(),state,base:{revision:remote.current.revision,snapshot:remote.current.saved},signal:lifetime.current!.signal,onRetry:()=>setNotice("Saving your chat…")});
    remote.current.revision=saved.revision;remote.current.saved=saved.snapshot;cachedBase.current=saved;setSaveRevision(v=>v+1);return saved;
  }

  useLayoutEffect(()=>navigation?.registerFlush(()=>flushCurrent()));

  async function startAnother() {
    if (coinTransition.current || busy || recoveryRequest || !restored || launchLocked) return;
    if(navigation){await navigation.newChat();return;}
    coinTransition.current = true; setSwitchingCoin(true);
    try {
    const previous = { messages, settings, draft, intent, draftId, contextId, pendingChange, image: imageReceipt, input, editTarget, request: retry.current ?? undefined,retryBase:retryBase.current,
      imageBlob: await readDraftCache<Blob>(`${storageKey}:image`) ?? undefined };
    await writeDraftCache(`${storageKey}:previous`, previous);
    setPreviousCoin(previous);
    await writeDraftCache(`${storageKey}:image`, null);
    setMessages([]); setSettings(EMPTY_COIN_SETUP); setDraft(undefined); setIntent(undefined); setDraftId(undefined);
    setContextId(undefined); setPendingChange(undefined); setImageReceipt(undefined); retry.current = null;
    setRecoveryRequest(undefined);retryBase.current=undefined;recovered.current=undefined;
    setEditTarget(undefined);
    setInput(""); setError(""); setNotice(""); setPreviewRevision(value => value + 1);
    textarea.current?.focus();
    } finally { coinTransition.current = false; setSwitchingCoin(false); }
  }
  async function restorePrevious() {
    if (!previousCoin || coinTransition.current || busy || recoveryRequest || !restored || launchLocked) return;
    coinTransition.current = true; setSwitchingCoin(true);
    try {
    await writeDraftCache(`${storageKey}:image`, previousCoin.imageBlob ?? null);
    setMessages(previousCoin.messages); setSettings(previousCoin.settings); setDraft(previousCoin.draft);
    setIntent(previousCoin.intent ?? previousCoin.draft?.intent);
    setDraftId(previousCoin.draftId); setContextId(previousCoin.contextId); setPendingChange(previousCoin.pendingChange);
    setImageReceipt(previousCoin.image); retry.current = previousCoin.request ?? null; setInput(previousCoin.input ?? ""); setError("");
    retryBase.current=previousCoin.retryBase??{messages:previousCoin.messages,pendingChange:previousCoin.pendingChange};recovered.current=undefined;setRecoveryRequest(previousCoin.request);
    setEditTarget(previousCoin.editTarget);
    setNotice("Previous coin restored."); setPreviewRevision(value => value + 1);
    textarea.current?.focus();
    } finally { coinTransition.current = false; setSwitchingCoin(false); }
  }
  async function restoreVersion(version:Pick<StoredStudio,"state"|"draft"|"intent">){
    if(busy||recoveryRequest||coinTransition.current||launchLocked||!version.draft)return;
    coinTransition.current=true;setSwitchingCoin(true);
    try{
    await writeDraftCache(`${storageKey}:image`,null);
    const state=version.state;
    setMessages(state.messages);setSettings(state.settings);setDraft(version.draft);setDraftId(state.draftId);
    setIntent(version.intent ?? version.draft.intent);
    setContextId(state.contextId);setPendingChange(state.pendingChange);setImageReceipt(state.image);
    retry.current=null;setInput("");setError("");setNotice("Saved rules restored.");setPreviewRevision(v=>v+1);
    setRecoveryRequest(undefined);retryBase.current=undefined;recovered.current=undefined;
    setEditTarget(undefined);
    }finally{coinTransition.current=false;setSwitchingCoin(false);}
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
    if (followReply.current && transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
    }
  }, [messages, busy, revealing]);

  useEffect(()=>{
    if(!restored||!recoveryRequest||conflict||recovered.current===recoveryRequest.id)return;
    recovered.current=recoveryRequest.id;
    const request=recoveryRequest,base:RetryBase=retryBase.current??{messages:request.messages.slice(0,-1)};
    const submitted=[...base.messages,request.messages.at(-1)!];
    const currentInput=textarea.current?.value??"";
    const preservedInput=currentInput&&currentInput.trim()!==request.messages.at(-1)!.content?currentInput:undefined;
    void replyRef.current.run({request,
      beforeSend:async()=>{setRequestSaved(true);setMessages(submitted);if(!preservedInput)setInput("");},
      onResult:data=>applyReply(request,data,submitted,base.pendingChange),
      onFailure:cause=>restoreFailedReply(request,cause,base,preservedInput),
      onSettled:()=>replySettled(false),
    },true);
  },[restored,recoveryRequest,conflict,applyReply,restoreFailedReply,replySettled]);

  async function send() {
    if (replyRef.current.isActive() || recoveryRequest || coinTransition.current || !restored || launchLocked) return;
    const content = input.trim();
    if (!content) { textarea.current?.focus(); return; }
    const base:RetryBase={messages,pendingChange};
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    const payload={...(conversationId?{conversation:{id:conversationId,account:owner,revision:retry.current?.conversation?.revision??remote.current.revision}}:{}),intent:"chat" as const,messages:conversationWindow(next),coin:settings,...(draftId?{draftId}:{}),...(contextId?{contextId}:{}),...(editTarget?{editTarget}:{})};
    const previousRequest=retry.current,candidate:ChatRequest={...payload,id:previousRequest?.id??crypto.randomUUID()};
    const request:ChatRequest=previousRequest&&sameAIRequest(previousRequest,candidate)?previousRequest:previousRequest?{...payload,id:crypto.randomUUID()}:candidate;
    const previousRetryBase=retryBase.current;
    const focus=document.activeElement===textarea.current||document.activeElement?.closest("form")===textarea.current?.form;
    await replyRef.current.run({request,
      beforeSend:async()=>{
        setRequestSaved(false);followReply.current=true;setShowLatest(false);setMessages(next);setInput("");setPendingChange(content);
        if(conversationId&&request!==previousRequest){const saved=await flushCurrent(true);request.conversation={id:conversationId,account:owner,revision:saved!.revision};}
        retry.current=request;retryBase.current=base;
        try{
          await writeDraftCache(storageKey,JSON.stringify({version:1,messages:next,input:"",editTarget,settings,draft,intent,draftId,contextId,pendingChange:content,image:imageReceipt,
            retry:request,retryBase:base,syncBase:cachedBase.current}));
          setRequestSaved(true);
        }catch{retry.current=previousRequest;retryBase.current=previousRetryBase;throw Error("This browser could not save the new request. Your previous saved request is kept.");}
      },
      onResult:data=>applyReply(request,data,next,base.pendingChange),
      onFailure:cause=>restoreFailedReply(request,cause,base),
      onSettled:()=>replySettled(focus),
    });
  }

  return <div className={styles.workspace}>
    <div className={styles.studio}>
    <section className={styles.conversation} aria-label="Build your coin">
      <WorkspaceTools name={settings.name} hasDraft={Boolean(draft)} disabled={busy || Boolean(recoveryRequest) || switchingCoin || !restored || launchLocked}
        navigation={navigation?.tools(launchLocked||!restored||switchingCoin||busy&&!requestSaved)}
        canClear={Boolean(messages.length)} hasPrevious={(!navigation||conversationId===LEGACY_CONVERSATION)&&Boolean(previousCoin)}
        onNewCoin={() => { void startAnother().catch(() => setError("Your current coin could not be saved. Try again.")); }}
        onRestorePrevious={() => { void restorePrevious().catch(() => setError("The previous coin could not be restored.")); }}
        onClearMessages={() => {
          setMessages([]); setInput(""); setEditTarget(undefined); retry.current = null; setError("");
          setNotice(`Messages cleared. You’re still editing ${settings.name.trim() || "this coin"}; its rules and open changes are kept.`); textarea.current?.focus();
        }}>
        {!localPreview&&owner!=="signed-out"&&<DraftVersions account={owner} conversationId={conversationId} headers={headers} disabled={busy||switchingCoin||launchLocked||!restored||saveFailed||Boolean(conflict)} currentDraftId={draftId} onRestore={restoreVersion}/>}
        {!localPreview&&owner!=="signed-out"&&<RequestInsights headers={headers} refreshKey={metricsRevision}/>}
        {usage && <details className={styles.toolSection}><summary>Usage</summary><div>
          <p>{usage.hourly.remaining} of {usage.hourly.limit} credits this hour · {usage.daily.remaining} of {usage.daily.limit} today</p>
          <p>Replies use 1 credit. Builds and live research use 5. An interrupted attempt may use up to 5.</p>
          <p>Hourly reset: {new Date(usage.hourly.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Daily reset: {new Date(usage.daily.resetsAt).toLocaleString()}.</p>
          {usage.resumesAt > 0 && <p>Available again at {new Date(usage.resumesAt).toLocaleString()}.</p>}
        </div></details>}
      </WorkspaceTools>
      <div ref={transcript} className={styles.transcript} role="log" aria-label="Conversation"
        aria-live="polite" aria-relevant="additions" onScroll={event => {
          const element = event.currentTarget;
          followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
          setShowLatest(!followReply.current);
        }}>
        {!messages.length && !busy && <div className={styles.empty}>
          <h2>{draft ? "Keep shaping your coin" : "What are we building?"}</h2>
          <p>{draft ? "Your saved rules are still here. Tell me what you’d like to change." : "Describe your idea. Shape the rules here, then launch from your wallet."}</p>
          <div className={styles.starterIdeas} aria-label="Ideas to get started">
            {starterIdeas.map(idea => <button type="button" key={idea.title} disabled={!restored || switchingCoin || launchLocked}
              onClick={() => { setInput(idea.prompt); textarea.current?.focus(); }}>{idea.title}<ArrowUp size={15} aria-hidden="true" /></button>)}
          </div>
        </div>}
        {messages.map((message, index) => <article className={styles.message} key={index} data-role={message.role}>
          <span className={styles.srOnly}>{message.role === "user" ? "You" : "Custom AI"}</span>
          <MessageContent content={message.content} />
          {message.role === "assistant" && message.sources?.length ? <ul className={styles.sources} aria-label="Sources">
            {safeKnowledgeSources(message.sources).map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}
          </ul> : null}
          <CopyButton label={message.role === "user" ? "Copy your message" : "Copy answer"} value={message.content} />
        </article>)}
        {busy && revealing === null && <div className={styles.typing} aria-hidden="true">
          <span /><span /><span />
        </div>}
        {revealing !== null && <StreamingReply text={revealing} onAdvance={followLatest} />}
      </div>
      {showLatest && messages.length > 0 && <button type="button" className={styles.jumpToLatest} onClick={() => {
        followReply.current = true; followLatest(); setShowLatest(false);
      }}>Latest message<ArrowDown size={14} aria-hidden="true" /></button>}
      <span className={busy ? styles.progress : styles.srOnly} role="status">
        {busy ? stopping ? "Confirming your stop request…" : ({ thinking: "Considering your request…", reading: "Checking current information…", building: "Building your rules…", checking: "Checking your rules…", repairing: "Refining your rules…", reconnecting: "Reconnecting to your saved reply…" }[phase.phase]) : notice}
      </span>
      {notice && <p className={styles.notice}>{notice}</p>}
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

      {editTarget && <div className={styles.editScope} role="status">
        <span>Editing: {draft?.composable?.spec.requirements.find(rule => rule.id === editTarget.requirementId)?.text ?? "Selected rule"}</span>
        <button type="button" aria-label="Edit the whole design instead" disabled={busy || launchLocked} onClick={() => setEditTarget(undefined)}><X size={16} aria-hidden="true" /></button>
      </div>}
      <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send(); }}>
        <label htmlFor="custom-ai-message" className={styles.srOnly}>Describe your coin or ask a question</label>
        <textarea ref={textarea} id="custom-ai-message" value={input} maxLength={8000} readOnly={busy || Boolean(recoveryRequest) || switchingCoin || !restored || launchLocked}
          aria-describedby={error ? "custom-ai-error" : "custom-ai-help"}
          placeholder="Describe your idea…" rows={1} onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
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
        </button> : <button type="submit" className={styles.send} disabled={!restored || Boolean(recoveryRequest) || switchingCoin || launchLocked} data-empty={!input.trim()} aria-label="Send message">
          <ArrowUp size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>}
      </form>
      <p className={styles.srOnly} id="custom-ai-help">Enter to send. Shift + Enter for a new line. Messages are processed by the configured AI provider.</p>
    </section>

    <CustomAILaunchPreview key={previewRevision} draft={draft} intent={intent} disabled={busy || Boolean(recoveryRequest) || switchingCoin || !restored} settings={settings} chatRevision={chatRevision} onChange={changeSettings}
      draftId={draftId} headers={headers} localPreview={localPreview} cacheKey={storageKey} onLaunchLocked={setLaunchLocked}
      imageReceipt={imageReceipt} onImageReceipt={setImageReceipt} pendingChange={busy ? undefined : pendingChange}
      onKeepRules={() => {
        setIntent(draft?.intent);
        setPendingChange(undefined); setContextId(draftId); setEditTarget(undefined);
        retry.current = null; setNotice("Keeping the previous rules.");
      }}
      onEditRule={requirementId => {
        if (!draft || busy || launchLocked) return;
        setEditTarget({ sourceHash: draft.sourceHash, requirementId });
        textarea.current?.focus();
      }}
      onStartAnother={() => { void startAnother().catch(() => setError("The previous coin could not be saved on this device. Try again.")); }} />
    </div>
  </div>;
}
