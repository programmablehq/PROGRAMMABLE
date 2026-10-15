"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { launchShareChain, launchShareCoinHref, launchSharePost, type LaunchShareData, type LaunchShareIdentity } from "@/lib/launch-share";
import { renderLaunchShareCard } from "@/lib/launch-share-card";
import styles from "./launch-share-view.module.css";

export function LaunchShareView({ identity }: { identity: LaunchShareIdentity }) {
  const [data, setData] = useState<LaunchShareData | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState(""); const [imageError, setImageError] = useState("");
  const [status, setStatus] = useState(""); const [attempt, setAttempt] = useState(0);
  const postRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/launch-share?address=${identity.address}&chain=${identity.chainId}`, { signal: abort.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "The launch could not be loaded.");
        if (body.address !== identity.address || body.chainId !== identity.chainId || body.href !== launchShareCoinHref(identity)) throw new Error("The coin identity did not match.");
        if (!abort.signal.aborted) setData(body);
      } catch (caught) { if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "The launch could not be loaded."); }
    })();
    return () => abort.abort();
  }, [identity, attempt]);
  useEffect(() => {
    if (!data) return;
    let active = true, objectUrl: string | null = null;
    void renderLaunchShareCard(data).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setImage(objectUrl); }
    }).catch(() => { if (active) setImageError("The image could not be created. You can still copy the post."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [data]);
  async function copyPost() {
    if (!data) return;
    try { await navigator.clipboard.writeText(launchSharePost(data)); setStatus("Post copied."); }
    catch { postRef.current?.focus(); postRef.current?.select(); setStatus("Select the post and copy it."); }
  }
  const filename = `${(data?.symbol || "coin").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "coin"}-${identity.chainId}-launch.png`;
  return <section className={styles.page} aria-labelledby="launch-share-title">
    <header className={styles.header}><h1 id="launch-share-title">Share your launch</h1><p>A ready-to-share image and post for your coin.</p></header>
    <div className={styles.panel}>
      {error ? <div className={styles.empty}><p role="alert">{error}</p><button className={styles.secondary} type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Try again</button></div> : <>
        <div className={styles.preview} aria-busy={!image && !imageError}>
          {image && data ? <Image src={image} alt={`${data.name}${data.symbol ? ` (${data.symbol})` : ""} launch card on ${launchShareChain(identity.chainId)}`} width={1200} height={630} unoptimized />
            : <p role="status">{imageError || "Preparing your image…"}</p>}
        </div>
        {data ? <div className={styles.post}>
          <label htmlFor="launch-share-post">Your post</label>
          <textarea id="launch-share-post" ref={postRef} value={launchSharePost(data)} readOnly rows={8} spellCheck={false} />
          <div className={styles.actions}>
            {image ? <a className={styles.primary} href={image} download={filename}>Download image</a> : <button type="button" className={styles.primary} disabled>Download image</button>}
            <button className={styles.secondary} type="button" onClick={() => void copyPost()}>Copy post</button>
          </div>
          {data.imageDataUrl === null ? <p className={styles.note}>Logo unavailable. The image uses your coin’s initials.</p> : null}
        </div> : null}
      </>}
      <p className={styles.status} role="status">{status}</p>
      <a className={styles.back} href={launchShareCoinHref(identity)}>Open coin</a>
    </div>
  </section>;
}
