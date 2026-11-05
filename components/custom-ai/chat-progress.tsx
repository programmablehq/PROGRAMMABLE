"use client";

import { useEffect, useState } from "react";
import styles from "./workspace.module.css";

/** Mount for each operation so its clock cannot carry over to the next reply. */
function ElapsedTime() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((performance.now() - start) / 1000);
      if (elapsed >= 10) setSeconds(elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return seconds < 10 ? null : <span className={styles.elapsed} aria-hidden="true">
    {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
  </span>;
}

/** Elapsed time is visual context, not an estimate or a repeated announcement. */
export function ChatProgressIndicator({ label, working, visible }: { label: string; working: boolean; visible: boolean }) {
  return <div id="custom-ai-state" className={visible ? styles.chatProgress : styles.srOnly}
    role="status" aria-live="polite" aria-atomic="true">
    {working && <span className={styles.workDots} aria-hidden="true"><span /><span /><span /></span>}
    <span>{label}</span>
    {working && <ElapsedTime />}
  </div>;
}
