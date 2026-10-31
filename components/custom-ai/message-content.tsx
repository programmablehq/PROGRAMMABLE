import { messageBlocks } from "@/lib/custom-ai/message-display";
import { CopyButton } from "./copy-button";
import styles from "./workspace.module.css";

export function MessageContent({ content }: { content: string }) {
  return <div className={styles.messageText}>
    {messageBlocks(content).map((block, index) => block.kind === "text"
      ? <span key={index}>{block.text}</span>
      : <div className={styles.codeBlock} key={index}>
          <div className={styles.codeToolbar}><span>{block.language || "Code"}</span><CopyButton label="Copy code" value={block.text} /></div>
          <pre tabIndex={0}><code>{block.text}</code></pre>
        </div>)}
  </div>;
}
