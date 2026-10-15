import { launchShareHref } from "@/lib/launch-share";
import styles from "./launch-share-link.module.css";

export function LaunchShareLink({ href }: { href: string }) {
  const target = launchShareHref(href);
  return target ? <a className={styles.link} href={target} target="_blank" rel="noopener noreferrer" aria-label="Share on X (opens in a new tab)">
    Share <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.9-9.1L2.5 2h6.4l4.5 6.8L18.9 2Zm-1.1 18h1.7L8 3.9H6.2L17.8 20Z" /></svg>
  </a> : null;
}
