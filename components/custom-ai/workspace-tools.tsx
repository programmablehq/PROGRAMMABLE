"use client";

import type { ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import styles from "./workspace.module.css";

export function WorkspaceTools({ name, hasDraft, disabled, canClear, hasPrevious, onNewCoin, onClearMessages, onRestorePrevious, children }: {
  name: string; hasDraft: boolean; disabled: boolean; canClear: boolean; hasPrevious: boolean;
  onNewCoin: () => void; onClearMessages: () => void; onRestorePrevious: () => void; children: ReactNode;
}) {
  return <header className={styles.chatToolbar}>
    <div className={styles.chatIdentity}>
      <span>{hasDraft ? "Editing your coin" : "Coin builder"}</span>
      <p>{name.trim() || "New coin"}</p>
    </div>
    <div className={styles.toolbarActions}>
      <button type="button" className={styles.newCoin} disabled={disabled} onClick={onNewCoin}>
        <Plus size={16} aria-hidden="true" />New coin
      </button>
      <details className={styles.tools}>
        <summary>Options<ChevronDown size={15} aria-hidden="true" /></summary>
        <div className={styles.toolsPanel}>
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
