"use client";

import { useEffect, useState } from "react";
import styles from "./workspace.module.css";

/** Elapsed time is visual context, not an estimate or a repeated announcement. */
export function ChatProgressIndicator({ label, working, visible }: { label: string; working: boolean; visible: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!working) return;
    const start = performance.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((performance.now() - start) / 1000);
      if (elapsed >= 10) setSeconds(elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [working]);

  return <div id="custom-ai-state" className={visible ? styles.chatProgress : styles.srOnly}
    role="status" aria-live="polite" aria-atomic="true">
    {working && <span className={styles.workDots} aria-hidden="true"><span /><span /><span /></span>}
    <span>{label}</span>
    {working && seconds >= 10 && <span className={styles.elapsed} aria-hidden="true">
      {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
    </span>}
  </div>;
}
