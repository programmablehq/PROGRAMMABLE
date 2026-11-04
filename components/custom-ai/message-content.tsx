import { memo } from "react";
import { assistantProseText, inlineParts, messageBlocks, textBlocks } from "@/lib/custom-ai/message-display";
import { CopyButton } from "./copy-button";
import styles from "./workspace.module.css";

function InlineText({ text, assistant }: { text: string; assistant: boolean }) {
  return inlineParts(text).map((part, index) => part.kind === "link"
    ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>
    : part.kind === "strong" ? <strong key={index}>{assistant ? assistantProseText(part.text) : part.text}</strong>
    : part.kind === "code" ? <code key={index}>{part.text}</code>
    : assistant ? assistantProseText(part.text) : part.text);
}

export const MessageContent = memo(function MessageContent({ content, assistant = false, streaming = false }: { content: string; assistant?: boolean; streaming?: boolean }) {
  return <div className={styles.messageText}>
    {messageBlocks(content).map((block, index) => block.kind === "text"
      ? <div key={index}>{textBlocks(block.text, assistant).map((part, at) => {
          if (part.kind === "list") {
            const items = part.items.map((item, n) => <li key={n}><InlineText text={item} assistant={assistant} /></li>);
            return part.ordered ? <ol key={at} start={part.start}>{items}</ol> : <ul key={at}>{items}</ul>;
          }
          const text = <InlineText text={part.text.trimEnd()} assistant={assistant} />;
          return part.kind === "heading" ? <h3 key={at}>{text}</h3>
            : part.kind === "quote" ? <blockquote key={at}>{text}</blockquote> : <p key={at}>{text}</p>;
        })}</div>
      : <div className={styles.codeBlock} key={index}>
          <div className={styles.codeToolbar}><span>{block.language || "Code"}</span>{!streaming && <CopyButton label="Copy code" value={block.text} />}</div>
          <pre tabIndex={streaming ? undefined : 0}><code>{block.text}</code></pre>
        </div>)}
  </div>;
});
