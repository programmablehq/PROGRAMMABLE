"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { ChatMessage, ChatRequest, Draft } from "@/lib/custom-ai/types";
import { CustomAILaunchPreview } from "./launch-preview";
import { EMPTY_COIN_SETUP, applyCoinSetupPatch, parseCoinSetupPatch, type CoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import { useWallet } from "@/components/wallet-provider";
import { sendAIChat, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { ImageReceipt, StoredStudio, StudioState } from "@/lib/custom-ai/studio";
import { loadStudio, restoreStudio, saveStudio, studioBase, studioSnapshot, StudioConflictError, type StudioBase } from "@/lib/custom-ai/studio-sync";
import { readDraftCache, writeDraftCache } from "@/lib/custom-ai/draft-cache";
import styles from "./workspace.module.css";

// Reveal only the complete provider answer. Partial display text never enters
// the conversation sent to the API, and stopping reveals the received answer.
function revealReply(text: string, signal: AbortSignal, update: (text: string) => void) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (motion.matches || signal.aborted || document.hidden) {
    update(text);
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    const characters = Array.from(text);
    const duration = Math.min(2200, Math.max(240, characters.length * 8));
    const start = performance.now();
    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", finish);
      motion.removeEventListener("change", finish);
      document.removeEventListener("visibilitychange", finish);
      update(text);
      resolve();
    };
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      update(characters.slice(0, Math.ceil(characters.length * progress)).join(""));
      if (progress === 1) finish();
      else frame = requestAnimationFrame(tick);
    };
    signal.addEventListener("abort", finish, { once: true });
    motion.addEventListener("change", finish, { once: true });
    document.addEventListener("visibilitychange", finish, { once: true });
    frame = requestAnimationFrame(tick);
  });
}

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [settings, setSettings] = useState(EMPTY_COIN_SETUP);
  const [draftId, setDraftId] = useState<string>();
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
          local = { messages: saved.messages, settings, draftId: saved.draftId, image: saved.image };
          if (Number.isSafeInteger(saved.syncBase?.revision) && saved.syncBase.revision >= 0 && typeof saved.syncBase.snapshot === "string") previousBase = saved.syncBase;
          cachedBase.current = previousBase;
          setMessages(saved.messages); setSettings(settings); setImageReceipt(saved.image);
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
    void writeDraftCache(storageKey, JSON.stringify({ version: 1, messages, settings, draft, draftId, image: imageReceipt, retry: retry.current,
      // Keep the last shared version so a failed save survives a reload.
      syncBase: cachedBase.current }))
      .catch(() => setNotice("This browser could not save your draft. Keep this tab open."));
  }, [storageKey, owner, restored, messages, settings, draft, draftId, imageReceipt, saveRevision]);

  useEffect(() => {
    if (!restored || localPreview || busy || !remote.current.ready || remote.current.blocked) return;
    try { parseCoinSetupPatch(settings); } catch { return; }
    const state: StudioState = { settings, messages, draftId, image: imageReceipt };
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
  }, [restored, localPreview, busy, settings, messages, draftId, imageReceipt, owner, saveRevision]);

  async function resolveConflict(useOnline: boolean) {
    if (!conflict) return;
    const server = conflict.server;
    if (useOnline) {
      try { await writeDraftCache(`${storageKey}:image`, null); }
      catch { setNotice("This browser could not update the saved image. Keep this tab open."); return; }
      if (lifetime.current?.signal.aborted) return;
      setMessages(server?.state.messages ?? []); setSettings(server?.state.settings ?? EMPTY_COIN_SETUP);
      setDraftId(server?.state.draftId); setDraft(server?.draft); setImageReceipt(server?.state.image); retry.current = null;
      setPreviewRevision(value => value + 1);
    }
    const base = studioBase(server);
    cachedBase.current = base;
    saveEpoch.current += 1;
    remote.current = { ready: true, revision: base.revision, saved: base.snapshot, blocked: false };
    setConflict(null); setNotice(""); setSaveRevision(value => value + 1);
  }

  useEffect(() => () => pending.current?.abort(), []);
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
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    const controller = new AbortController();
    pending.current = controller;
    followReply.current = true;
    setBusy(true); setError(""); setNotice(""); setMessages(next); setInput("");
    try {
      const payload = { intent: "chat" as const, messages: next, coin: settings };
      const previousRequest = retry.current;
      const request: ChatRequest = previousRequest && JSON.stringify({ ...previousRequest, id: undefined }) === JSON.stringify(payload)
        ? previousRequest : { ...payload, id: crypto.randomUUID() };
      retry.current = request;
      const data = await sendAIChat(request, headers, controller.signal);
      if (typeof data.reply !== "string") throw new Error("The reply did not arrive. Try again.");
      retry.current = null;
      if (data.draft) { setDraft(data.draft); setDraftId(request.id); }
      if (data.setupPatch) { changeSettings(data.setupPatch); setChatRevision(value => value + 1); }
      setRevealing("");
      await revealReply(data.reply, controller.signal, setRevealing);
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (cause) {
      setMessages(previous); setInput(content);
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
      <div ref={transcript} className={styles.transcript} role="log" aria-label="Conversation"
        aria-live="polite" aria-relevant="additions" onScroll={event => {
          const element = event.currentTarget;
          followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
        }}>
        {!messages.length && !busy && <div className={styles.empty}><h2>What are we building?</h2></div>}
        {messages.map((message, index) => <article className={styles.message} key={index} data-role={message.role}>
          <span className={styles.srOnly}>{message.role === "user" ? "You" : "Custom AI"}</span>
          <div className={styles.messageText}>{message.content}</div>
        </article>)}
        {busy && revealing === null && <div className={styles.typing} aria-hidden="true">
          <span /><span /><span />
        </div>}
        {revealing !== null && <div className={styles.message} data-role="assistant" aria-hidden="true">
          <div className={`${styles.messageText} ${styles.revealing}`}>{revealing}</div>
        </div>}
      </div>
      <span className={styles.srOnly} role="status">
        {busy ? "Custom AI is working on your reply." : notice}
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
          aria-label={revealing !== null ? "Show full reply" : "Stop response"} onClick={event => {
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
      imageReceipt={imageReceipt} onImageReceipt={setImageReceipt} />
    </div>
  </div>;
}
