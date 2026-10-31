"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import styles from "./workspace.module.css";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const writing = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    if (writing.current) return;
    writing.current = true;
    clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setStatus("copied");
      timer.current = setTimeout(() => setStatus("idle"), 2000);
    } catch { setStatus("failed"); }
    finally { writing.current = false; }
  }
  return <span className={styles.copyAction}>
    <button type="button" disabled={!value} onClick={() => void copy()} aria-label={status === "copied" ? `${label}: copied` : label}>
      {status === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span>{status === "copied" ? "Copied" : label}</span>
    </button>
    <span role="status" className={status === "failed" ? styles.copyError : styles.srOnly}>
      {status === "failed" ? "Copy did not work. Select the text and copy it manually." : status === "copied" ? "Copied to clipboard." : ""}
    </span>
  </span>;
}
