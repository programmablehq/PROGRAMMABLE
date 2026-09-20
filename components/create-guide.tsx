"use client";

import {
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { ArrowRight, CircleHelp, X } from "lucide-react";

import styles from "@/components/create-guide.module.css";

export function CreateGuide() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function openGuide() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;

    dialog.showModal();
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
  }

  function closeGuide() {
    dialogRef.current?.close();
  }

  function handleDialogClose() {
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleDialogClick(event: ReactMouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeGuide();
  }

  return (
    <div className={styles.entry}>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-haspopup="dialog"
        aria-controls="create-guide-dialog"
        onClick={openGuide}
      >
        <CircleHelp aria-hidden="true" size={17} strokeWidth={1.8} />
        How does it work?
      </button>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        id="create-guide-dialog"
        aria-labelledby="create-guide-title"
        aria-describedby="create-guide-description"
        onClick={handleDialogClick}
        onClose={handleDialogClose}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Launch</p>
            <h2 id="create-guide-title">Choose how to build</h2>
          </div>
          <button
            ref={closeButtonRef}
            className={styles.closeButton}
            type="button"
            aria-label="Close guide"
            onClick={closeGuide}
          >
            <X aria-hidden="true" size={19} strokeWidth={1.8} />
          </button>
        </header>

        <div className={styles.content}>
          <p className={styles.lede} id="create-guide-description">
            Use a module for a ready made launch, or build your own trading rules with a custom hook.
          </p>
          <ul className={styles.choices}>
            <li>
              <div>
                <h3>Launch with a module</h3>
                <p>Choose your coin details and trading pair, then review the launch in your wallet.</p>
                <div className={styles.links}>
                  <Link href="/launch/modules/foundation" onClick={closeGuide}>Launch a coin <ArrowRight aria-hidden="true" size={15} /></Link>
                </div>
              </div>
            </li>
            <li>
              <div>
                <h3>Build a custom hook</h3>
                <p>Create an API key and give the instructions to your coding assistant. Describe what you want your coin to do.</p>
                <div className={styles.links}>
                  <Link href="/developers/api-keys?guide=custom-hook" onClick={closeGuide}>API keys and build guide <ArrowRight aria-hidden="true" size={15} /></Link>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </dialog>
    </div>
  );
}
