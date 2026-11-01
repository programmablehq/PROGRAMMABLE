"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import styles from "./workspace.module.css";

export function WorkspaceTools({ name, hasDraft, disabled, canClear, hasPrevious, onNewCoin, onClearMessages, onRestorePrevious, navigation, children }: {
  name: string; hasDraft: boolean; disabled: boolean; canClear: boolean; hasPrevious: boolean;
  onNewCoin: () => void; onClearMessages: () => void; onRestorePrevious: () => void; navigation?: ReactNode; children: ReactNode;
}) {
  const tools = useRef<HTMLDetailsElement>(null);
  function closeTools() {
    if (!tools.current) return;
    tools.current.open = false;
    tools.current.querySelector("summary")?.focus();
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (tools.current?.open && event.target instanceof Node && !tools.current.contains(event.target)) tools.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return <header className={styles.chatToolbar}>
    <div className={styles.chatIdentity}>
      <span>{hasDraft ? "Editing your coin" : "Coin builder"}</span>
      <p>{name.trim() || "New coin"}</p>
    </div>
    <div className={styles.toolbarActions}>
      {navigation}
      <button type="button" className={styles.newCoin} disabled={disabled} onClick={onNewCoin}>
        <Plus size={16} aria-hidden="true" />New coin
      </button>
      <details ref={tools} className={styles.tools} onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); closeTools(); }
      }}>
        <summary>Options<ChevronDown size={15} aria-hidden="true" /></summary>
        <div className={styles.toolsPanel}>
          <button className={styles.toolsClose} type="button" aria-label="Close options" onClick={closeTools}>Close<X size={16} aria-hidden="true" /></button>
          <section className={styles.contextActions} aria-label="Conversation options">
            <button type="button" disabled={disabled || !canClear} onClick={onClearMessages}>Clear messages</button>
            <p>Keep this coin and its rules. Only the conversation view is cleared.</p>
            {hasPrevious && <button type="button" disabled={disabled} onClick={onRestorePrevious}>Restore previous coin</button>}
          </section>
          {children}
        </div>
      </details>
    </div>
  </header>;
}
