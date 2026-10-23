"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { AIUsage, ChatMessage, ChatProgress, ChatRequest, Draft } from "@/lib/custom-ai/types";
import { CustomAILaunchPreview } from "./launch-preview";
import { EMPTY_COIN_SETUP, applyCoinSetupPatch, parseCoinSetupPatch, type CoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import { useWallet } from "@/components/wallet-provider";
import { AIRequestError, aiRequest, sendAIChat, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { ImageReceipt, StoredStudio, StudioState } from "@/lib/custom-ai/studio";
import { loadStudio, restoreStudio, saveStudio, studioBase, studioSnapshot, StudioConflictError, type StudioBase } from "@/lib/custom-ai/studio-sync";
import { readDraftCache, writeDraftCache } from "@/lib/custom-ai/draft-cache";
import { conversationWindow } from "@/lib/custom-ai/conversation";
import { safeKnowledgeSources } from "@/lib/custom-ai/knowledge";
import styles from "./workspace.module.css";

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
  return <CustomAISession key={owner} owner={owner} headers={headers} localPreview={localPreview} />;
}

function CustomAISession({ owner, headers, localPreview }: { owner: string; headers: AISessionHeaders; localPreview: boolean }) {
  type PreviousCoin = StudioState & { draft?: Draft; imageBlob?: Blob };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [settings, setSettings] = useState(EMPTY_COIN_SETUP);
  const [draftId, setDraftId] = useState<string>();
  const [contextId, setContextId] = useState<string>();
  const [pendingChange, setPendingChange] = useState<string>();
  const [usage, setUsage] = useState<AIUsage>();
  const [previousCoin, setPreviousCoin] = useState<PreviousCoin>();
  const [phase, setPhase] = useState<ChatProgress & { type: "phase" }>({ type: "phase", phase: "thinking" });
  const [imageReceipt, setImageReceipt] = useState<ImageReceipt>();
  const [restored, setRestored] = useState(false);
  const [launchLocked, setLaunchLocked] = useState(false);
  const retry = useRef<ChatRequest | null>(null);
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
  const storageKey = `programmable.custom-ai.studio.v1:${owner}`;
  const [chatRevision, setChatRevision] = useState(0);
  function changeSettings(patch: CoinSetupPatch) { setSettings(current => applyCoinSetupPatch(current, patch)); }
  const pending = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);

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
          local = { messages: saved.messages, settings, draftId: saved.draftId, contextId: saved.contextId, pendingChange: saved.pendingChange, image: saved.image };
          if (Number.isSafeInteger(saved.syncBase?.revision) && saved.syncBase.revision >= 0 && typeof saved.syncBase.snapshot === "string") previousBase = saved.syncBase;
          cachedBase.current = previousBase;
          setMessages(saved.messages); setSettings(settings); setImageReceipt(saved.image);
          setContextId(saved.contextId); setPendingChange(saved.pendingChange);
          if (saved.draft && typeof saved.draft.source === "string") setDraft(saved.draft);
          if (typeof saved.draftId === "string") setDraftId(saved.draftId);
          retry.current = saved.retry ?? null;
          if (saved.retry?.messages?.at(-1)?.role === "user") {
            setMessages(saved.retry.messages.slice(0, -1));
            setInput(saved.retry.messages.at(-1).content);
            local.messages = saved.retry.messages.slice(0, -1);
          }
        }
      }
    }).catch(() => { /* An unreadable local cache never authorizes a launch. */ })
      .finally(async () => {
        if (cancelled) return;
        if (!localPreview && owner !== "signed-out") {
          try {
            const server = await loadStudio(owner, () => headersRef.current(), controller.signal);
            if (cancelled) return;
            const restored = restoreStudio(local, previousBase, server);
            if (server && !restored.keepLocal) {
              setMessages(server.state.messages); setSettings(server.state.settings);
              setDraftId(server.state.draftId); setDraft(server.draft); setImageReceipt(server.state.image);
              setContextId(server.state.contextId); setPendingChange(server.state.pendingChange);
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
  }, [storageKey, localPreview, owner, restoreRevision]);
  useEffect(() => {
    if (!restored || owner === "signed-out") return;
    void writeDraftCache(storageKey, JSON.stringify({ version: 1, messages, settings, draft, draftId, contextId, pendingChange, image: imageReceipt, retry: retry.current,
      // Keep the last shared version so a failed save survives a reload.
      syncBase: cachedBase.current }))
      .catch(() => setNotice("This browser could not save your draft. Keep this tab open."));
  }, [storageKey, owner, restored, messages, settings, draft, draftId, contextId, pendingChange, imageReceipt, saveRevision]);

  useEffect(() => {
    if (!restored || localPreview || busy || !remote.current.ready || remote.current.blocked) return;
    try { parseCoinSetupPatch(settings); } catch { return; }
    const state: StudioState = { settings, messages, draftId, contextId, pendingChange, image: imageReceipt };
    const snapshot = studioSnapshot(state);
    if (snapshot === remote.current.saved) return;
    const signal = lifetime.current!.signal;
    const epoch = saveEpoch.current;
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        if (signal.aborted || epoch !== saveEpoch.current || remote.current.blocked || snapshot === remote.current.saved) return;
        try {
          const saved = await saveStudio({ account: owner, headers: () => headersRef.current(), state,
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
  }, [restored, localPreview, busy, settings, messages, draftId, contextId, pendingChange, imageReceipt, owner, saveRevision]);

  async function resolveConflict(useOnline: boolean) {
    if (!conflict) return;
    const server = conflict.server;
    if (useOnline) {
      try { await writeDraftCache(`${storageKey}:image`, null); }
      catch { setNotice("This browser could not update the saved image. Keep this tab open."); return; }
      if (lifetime.current?.signal.aborted) return;
      setMessages(server?.state.messages ?? []); setSettings(server?.state.settings ?? EMPTY_COIN_SETUP);
      setDraftId(server?.state.draftId); setDraft(server?.draft); setImageReceipt(server?.state.image); retry.current = null;
      setContextId(server?.state.contextId); setPendingChange(server?.state.pendingChange);
      setPreviewRevision(value => value + 1);
    }
    const base = studioBase(server);
    cachedBase.current = base;
    saveEpoch.current += 1;
    remote.current = { ready: true, revision: base.revision, saved: base.snapshot, blocked: false };
    setConflict(null); setNotice(""); setSaveRevision(value => value + 1);
  }

  useEffect(() => () => pending.current?.abort(), []);
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

  async function startAnother() {
    const previous = { messages, settings, draft, draftId, contextId, pendingChange, image: imageReceipt,
      imageBlob: await readDraftCache<Blob>(`${storageKey}:image`) ?? undefined };
    await writeDraftCache(`${storageKey}:previous`, previous);
    setPreviousCoin(previous);
    await writeDraftCache(`${storageKey}:image`, null);
    setMessages([]); setSettings(EMPTY_COIN_SETUP); setDraft(undefined); setDraftId(undefined);
    setContextId(undefined); setPendingChange(undefined); setImageReceipt(undefined); retry.current = null;
    setInput(""); setError(""); setNotice(""); setPreviewRevision(value => value + 1);
  }
  async function restorePrevious() {
    if (!previousCoin) return;
    await writeDraftCache(`${storageKey}:image`, previousCoin.imageBlob ?? null);
    setMessages(previousCoin.messages); setSettings(previousCoin.settings); setDraft(previousCoin.draft);
    setDraftId(previousCoin.draftId); setContextId(previousCoin.contextId); setPendingChange(previousCoin.pendingChange);
    setImageReceipt(previousCoin.image); retry.current = null; setInput(""); setError("");
    setNotice("Previous coin restored."); setPreviewRevision(value => value + 1);
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

  async function send() {
    if (pending.current || !restored || launchLocked) return;
    const content = input.trim();
    if (!content) { textarea.current?.focus(); return; }
    const previous = messages;
    const previousPending = pendingChange;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    const controller = new AbortController();
    pending.current = controller;
    followReply.current = true;
    setBusy(true); setError(""); setNotice(""); setMessages(next); setInput(""); setPendingChange(content); setPhase({ type: "phase", phase: "thinking" });
    try {
      const payload = { intent: "chat" as const, messages: conversationWindow(next), coin: settings, ...(draftId ? { draftId } : {}), ...(contextId ? { contextId } : {}) };
      const previousRequest = retry.current;
      const request: ChatRequest = previousRequest && JSON.stringify({ ...previousRequest, id: undefined }) === JSON.stringify(payload)
        ? previousRequest : { ...payload, id: crypto.randomUUID() };
      retry.current = request;
      const data = await sendAIChat(request, headers, controller.signal, event => {
        if (event.type === "reply") setRevealing(event.text);
        else setPhase(event);
      });
      if (typeof data.reply !== "string") throw new Error("The reply did not arrive. Try again.");
      retry.current = null;
      if (data.draft) { setDraft(data.draft); setDraftId(request.id); }
      if (data.setupPatch) { changeSettings(data.setupPatch); setChatRevision(value => value + 1); }
      setContextId(request.id);
      setPendingChange(data.change === "applied" ? undefined : data.change === "blocked" ? content : previousPending);
      const sources = safeKnowledgeSources(data.sources);
      const completed: ChatMessage[] = [...next, { role: "assistant", content: data.reply, ...(sources.length ? { sources } : {}) }];
      const kept = conversationWindow(completed, 40, 30_000);
      setMessages(kept);
      if (kept.length < completed.length) setNotice("Earlier messages are summarized. Your agreed rules and current contract are kept.");
    } catch (cause) {
      // A terminal failure starts a fresh attempt on the next user action.
      // Lost responses retain their ID so a paid request is never replayed blindly.
      if (cause instanceof AIRequestError && cause.requestState === "failed") retry.current = null;
      setMessages(previous); setInput(content);
      setSaveRevision(value => value + 1);
      if (controller.signal.aborted) setNotice("Stopped. Your last draft is unchanged.");
      else setError(cause instanceof Error ? cause.message : "The reply did not arrive. Try again.");
    } finally {
      pending.current = null;
      setBusy(false); setRevealing(null);
      if (document.activeElement?.closest("form") || document.activeElement === document.body) textarea.current?.focus();
    }
  }

  return <div className={styles.workspace}>
    <div className={styles.studio}>
    <section className={styles.conversation} aria-label="Build your coin">
      <div className={styles.chatToolbar}>
        <button type="button" disabled={busy || !restored || launchLocked || !messages.length} onClick={() => {
          setMessages([]); setInput(""); retry.current = null; setError("");
          setNotice("New conversation. Your saved rules and coin details are kept."); textarea.current?.focus();
        }}>New conversation</button>
        <details className={styles.usage}><summary>Coin</summary><div>
          <button type="button" disabled={busy || !restored || launchLocked} onClick={() => {
            void startAnother().catch(() => setError("Your current coin could not be saved. Try again."));
          }}>Start a new coin</button>
          {previousCoin && <button type="button" disabled={busy || !restored || launchLocked} onClick={() => {
            void restorePrevious().catch(() => setError("The previous coin could not be restored."));
          }}>Restore previous coin</button>}
        </div></details>
        {usage && <details className={styles.usage}><summary>Usage</summary><div>
          <p>{usage.hourly.remaining} of {usage.hourly.limit} credits this hour · {usage.daily.remaining} of {usage.daily.limit} today</p>
          <p>Replies use 1 credit. Builds and live research use 5. An interrupted attempt may use up to 5.</p>
          <p>Hourly reset: {new Date(usage.hourly.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Daily reset: {new Date(usage.daily.resetsAt).toLocaleString()}.</p>
          {usage.resumesAt > 0 && <p>Available again at {new Date(usage.resumesAt).toLocaleString()}.</p>}
        </div></details>}
      </div>
      <div ref={transcript} className={styles.transcript} role="log" aria-label="Conversation"
        aria-live="polite" aria-relevant="additions" onScroll={event => {
          const element = event.currentTarget;
          followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
        }}>
        {!messages.length && !busy && <div className={styles.empty}><h2>What are we building?</h2></div>}
        {messages.map((message, index) => <article className={styles.message} key={index} data-role={message.role}>
          <span className={styles.srOnly}>{message.role === "user" ? "You" : "Custom AI"}</span>
          <div className={styles.messageText}>{message.content}</div>
          {message.role === "assistant" && message.sources?.length ? <ul className={styles.sources} aria-label="Sources">
            {safeKnowledgeSources(message.sources).map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}
          </ul> : null}
        </article>)}
        {busy && revealing === null && <div className={styles.typing} aria-hidden="true">
          <span /><span /><span />
        </div>}
        {revealing !== null && <div className={styles.message} data-role="assistant" aria-hidden="true">
          <div className={`${styles.messageText} ${styles.revealing}`}>{revealing}</div>
        </div>}
      </div>
      <span className={busy ? styles.progress : styles.srOnly} role="status">
        {busy ? ({ thinking: "Considering your request…", reading: "Checking current information…", building: "Building your rules…", checking: "Checking your rules…", repairing: "Refining your rules…" }[phase.phase]) : notice}
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

      <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send(); }}>
        <label htmlFor="custom-ai-message" className={styles.srOnly}>Describe your coin or ask a question</label>
        <textarea ref={textarea} id="custom-ai-message" value={input} maxLength={8000} readOnly={busy || !restored || launchLocked}
          aria-describedby={error ? "custom-ai-error" : "custom-ai-help"}
          placeholder="Describe your idea…" rows={1} onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); void send();
            }
          }} />
        {busy ? <button type="button" className={styles.send}
          aria-label="Stop response" onClick={event => {
            event.preventDefault();
            pending.current?.abort();
          }}>
          <Square size={15} strokeWidth={1.75} aria-hidden="true" />
        </button> : <button type="submit" className={styles.send} disabled={!restored || launchLocked} data-empty={!input.trim()} aria-label="Send message">
          <ArrowUp size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>}
      </form>
      <p className={styles.srOnly} id="custom-ai-help">Enter to send. Shift + Enter for a new line. Messages are sent to Claude.</p>
    </section>

    <CustomAILaunchPreview key={previewRevision} draft={draft} disabled={busy || !restored} settings={settings} chatRevision={chatRevision} onChange={changeSettings}
      draftId={draftId} headers={headers} localPreview={localPreview} cacheKey={storageKey} onLaunchLocked={setLaunchLocked}
      imageReceipt={imageReceipt} onImageReceipt={setImageReceipt} pendingChange={busy ? undefined : pendingChange}
      onKeepRules={() => { setPendingChange(undefined); setNotice("Keeping the previous rules."); }}
      onStartAnother={() => { void startAnother().catch(() => setError("The previous coin could not be saved on this device. Try again.")); }} />
    </div>
  </div>;
}
