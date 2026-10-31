"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { advanceReply } from "@/lib/custom-ai/message-display";
import { CopyButton } from "./copy-button";
import styles from "./workspace.module.css";

export function StreamingReply({ text, onAdvance }: { text: string; onAdvance: () => void }) {
  const [visible, setVisible] = useState("");
  const shown = useRef("");
  useEffect(() => {
    let frame = 0, lastFrame = -Infinity;
    const started = performance.now();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const tick = (time: number) => {
      if (time - lastFrame >= 24) {
        shown.current = advanceReply(shown.current, text, time - started, media.matches);
        setVisible(shown.current);
        lastFrame = time;
      }
      if (shown.current !== text) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  useLayoutEffect(() => { onAdvance(); }, [visible, onAdvance]);
  return <div className={styles.message} data-role="assistant">
    <div className={`${styles.messageText} ${styles.revealing}`} aria-hidden="true">{visible}</div>
    <CopyButton label="Copy current reply" value={visible} />
  </div>;
}
