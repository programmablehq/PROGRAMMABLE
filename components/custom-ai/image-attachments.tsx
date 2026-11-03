"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Upload } from "lucide-react";
import styles from "./workspace.module.css";

export function ImageAttachments({ disabled, onChoose, onURL }: {
  disabled: boolean; onChoose: () => void; onURL: (url: string) => Promise<boolean>;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [url, setURL] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (open && menu.current && event.target instanceof Node && !menu.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  async function attachURL() {
    if (working || disabled) return;
    try { if (new URL(url).protocol !== "https:") throw Error(); }
    catch { setError("Use a public HTTPS image link."); return; }
    setWorking(true); setError("");
    try {
      if (await onURL(url.trim())) { setURL(""); close(); }
      else setError("That image could not be loaded. Try another direct image link.");
    } catch { setError("The image could not be saved. Your current image is unchanged.");
    } finally { setWorking(false); }
  }
  return <div ref={menu} className={styles.imageAttachments} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  }}>
    <button ref={trigger} type="button" aria-label="Attach image" aria-expanded={open} aria-controls="custom-ai-image-options"
      disabled={disabled || working} onClick={() => setOpen(current => !current)}><ImagePlus size={19} aria-hidden="true" /></button>
    {open && <div id="custom-ai-image-options" className={styles.attachmentMenu} role="group" aria-label="Coin image options">
      <button type="button" disabled={disabled || working} onClick={() => { close(); onChoose(); }}>
        <Upload size={16} aria-hidden="true" />Upload image
      </button>
      <label htmlFor="custom-ai-image-link">Or use an image link</label>
      <input id="custom-ai-image-link" name="imageLink" type="url" inputMode="url" autoComplete="off" autoCapitalize="none"
        spellCheck={false} value={url} disabled={working} placeholder="https://…" aria-invalid={Boolean(error)}
        aria-describedby={error ? "custom-ai-image-link-error" : undefined}
        onChange={event => { setURL(event.target.value); setError(""); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void attachURL(); } }} />
      <button type="button" disabled={disabled || working || !url.trim()} onClick={() => void attachURL()}>
        {working ? "Loading image…" : "Use image"}
      </button>
      {error && <p id="custom-ai-image-link-error" role="alert">{error}</p>}
    </div>}
  </div>;
}
