import type { ReactNode } from "react";
import styles from "./workspace.module.css";

export function WorkspaceTools({ name, navigation, access }: {
  name: string;
  navigation?: ReactNode;
  access?: ReactNode;
}) {
  return <header className={styles.chatToolbar}>
    <div className={styles.chatIdentity}><p>{name.trim() || "New coin"}</p></div>
    <div className={styles.toolbarActions}>{access}{navigation}</div>
  </header>;
}
