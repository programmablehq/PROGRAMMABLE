"use client";

import { useEffect, useState } from "react";
import styles from "./workspace.module.css";

export function SessionLoading({ onReconnect }: { onReconnect: () => void }) {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDelayed(true), 12_000);
    return () => clearTimeout(timer);
  }, []);
  return <div className={`${styles.workspace} ${styles.libraryEmpty}`}>
    <p role="status">{delayed ? "Your wallet connection is taking longer than expected." : "Checking your wallet connection…"}</p>
    {delayed && <><p>Your saved chats are kept. Reconnect your wallet to continue.</p>
      <button type="button" className={styles.textButton} onClick={onReconnect}>Reconnect wallet</button></>}
  </div>;
}
