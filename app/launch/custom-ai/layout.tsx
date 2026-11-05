import type { ReactNode } from "react";
import styles from "@/components/custom-ai/workspace.module.css";

export default function CustomAILayout({ children }: { children: ReactNode }) {
  return <><div className={styles.pageBackdrop} aria-hidden="true" />{children}</>;
}
