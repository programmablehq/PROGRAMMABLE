import Link from "next/link";
import { launchShareHref } from "@/lib/launch-share";
import styles from "./launch-share-link.module.css";

export function LaunchShareLink({ href }: { href: string }) {
  const target = launchShareHref(href);
  return target ? <Link className={styles.link} href={target} prefetch={false}>Share launch</Link> : null;
}
