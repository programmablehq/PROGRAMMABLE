"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./responsive-trade-panel.module.css";

/** The same trade controls stay mounted when the mobile sheet opens or closes. */
export function ResponsiveTradePanel({ children, symbol }: { children: ReactNode; symbol?: string }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1000px)");
    const update = () => {
      if (!dialog.current) return;
      if (media.matches) dialog.current.close();
      else {
        if (dialog.current.matches(":modal")) dialog.current.close();
        // Setting the nonmodal open attribute preserves desktop focus and scroll.
        dialog.current.open = true;
      }
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return <div className={styles.host}>
    <div className={styles.dock}>
      <button ref={trigger} type="button" className={styles.openButton} aria-haspopup="dialog" aria-controls={id}
        onClick={() => {
          if (!dialog.current) return;
          dialog.current.dataset.sheetOpen = "true";
          setSheetOpen(true);
          dialog.current.showModal();
        }}>Trade{symbol ? ` ${symbol}` : ""}</button>
    </div>
    <dialog ref={dialog} id={id} open className={styles.panel} data-sheet-open={sheetOpen} aria-label={symbol ? `Trade ${symbol}` : "Trade"}
      onClose={() => { setSheetOpen(false); if (sheetOpen && window.matchMedia("(max-width: 1000px)").matches) trigger.current?.focus(); }}
      onClick={event => {
        if (event.target !== event.currentTarget || !event.currentTarget.open) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
      }}>
      <div className={styles.sheetHeader}>
        <h2>{symbol ? `Trade ${symbol}` : "Trade"}</h2>
        <button type="button" className={styles.closeButton} aria-label="Close trade" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button>
      </div>
      {children}
    </dialog>
  </div>;
}
