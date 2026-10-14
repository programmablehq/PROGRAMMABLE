"use client";

import Image from "next/image";
import { Bell, Pin, ArrowUpRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./fomo-team-tag.module.css";

export function FomoTeamTagButton({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className={styles.trigger} type="button" aria-label={`Set up a fomo team tag for ${name}`}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Image src="/brand/fomo-logo-white.svg" width={36} height={36} alt="" unoptimized />
    </button>
    {open ? <FomoTeamTagDialog onClose={() => setOpen(false)} /> : null}
  </>;
}

function FomoTeamTagDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const title = useId();
  const description = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    const gutter = root.style.scrollbarGutter;
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    element.showModal();
    close.current?.focus();
    return () => {
      element.close();
      root.style.overflow = overflow;
      root.style.scrollbarGutter = gutter;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} aria-describedby={description}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, a[href]"));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.content}>
      <button ref={close} className={styles.close} type="button" aria-label="Close fomo team tag" onClick={onClose}>
        <X size={20} aria-hidden="true" />
      </button>
      <h2 id={title}>Reach your holders on fomo</h2>
      <p id={description} className={styles.intro}>Set up a team tag on fomo</p>
      <div className={styles.features}>
        <div className={styles.feature}>
          <span className={styles.icon}><Pin size={22} aria-hidden="true" /></span>
          <div><h3>Stand out to your holders</h3><p>A team tag marks you as part of the team and pins you at the top of your token’s holder list.</p></div>
        </div>
        <div className={styles.feature}>
          <span className={styles.icon}><Bell size={22} aria-hidden="true" /></span>
          <div><h3>Reach your holders</h3><p>When you post a thesis about your token, your holders receive a notification.</p></div>
        </div>
      </div>
      <a className={styles.setup} href="https://fomo.family/team-tag-form" target="_blank" rel="noopener noreferrer">
        Set up on fomo <ArrowUpRight size={20} aria-hidden="true" /><span className={styles.visuallyHidden}> (opens in a new tab)</span>
      </a>
    </div>
  </dialog>;
}
