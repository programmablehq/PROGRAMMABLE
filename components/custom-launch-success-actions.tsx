import Image from "next/image";
import { LaunchShareLink } from "./launch-share-link";
import styles from "./custom-launch-success-actions.module.css";

export function CustomLaunchSuccessActions({ href }: { href: string }) {
  return (
    <div className={styles.actions} role="group" aria-label="Launch actions">
      <a className={styles.openCoin} href={href}>Open coin</a>
      <a
        className={styles.teamTag}
        href="https://fomo.family/team-tag-form"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Setup Team Tag on fomo (opens in a new tab)"
      >
        <span>Setup Team Tag</span>
        <Image src="/brand/fomo-logo-black.svg" width={36} height={36} alt="fomo" unoptimized />
      </a>
      <div className={styles.share}><LaunchShareLink href={href} /></div>
    </div>
  );
}
