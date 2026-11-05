import type { ReactNode } from "react";
import styles from "./workspace.module.css";

/** Keep the chat surface in place while its session or saved work loads. */
export function WorkspacePending({ status = "Opening AI Chat…", navigation, children }: {
  status?: string;
  navigation?: () => ReactNode;
  children?: ReactNode;
}) {
  return <div className={styles.workspace}>
    <div className={styles.studio}>
      <section className={styles.conversation} aria-label="Build your coin" aria-busy={Boolean(status)}>
        <header className={styles.chatToolbar}>
          <div className={styles.chatIdentity}><p>AI Chat</p></div>
          <div className={styles.toolbarActions}>{navigation?.()}</div>
        </header>
        <div className={styles.pendingBody}>
          {status && <p role="status">{status}</p>}
          {children}
        </div>
        <div className={styles.pendingComposer} aria-hidden="true" />
      </section>
      <div className={styles.pendingPreview} aria-hidden="true" />
    </div>
  </div>;
}
