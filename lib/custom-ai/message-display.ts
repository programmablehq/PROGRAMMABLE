export type MessageBlock = { kind: "text"; text: string } | { kind: "code"; text: string; language: string };

/** Display-only parsing. The original message remains the authority for copying. */
export function messageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const opening = /^```([a-z0-9_+-]{0,32})[ \t]*\r?\n/gim;
  let cursor = 0;
  for (let match = opening.exec(content); match; match = opening.exec(content)) {
    const closing = /^```[ \t]*(?:\r?\n|$)/gm;
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(content);
    if (!end) break;
    if (match.index > cursor) blocks.push({ kind: "text", text: content.slice(cursor, match.index) });
    blocks.push({ kind: "code", language: match[1], text: content.slice(opening.lastIndex, end.index) });
    cursor = closing.lastIndex;
    opening.lastIndex = cursor;
  }
  if (cursor < content.length) blocks.push({ kind: "text", text: content.slice(cursor) });
  return blocks;
}

/** Bound presentation lag while avoiding partial words and split Unicode points. */
export function advanceReply(current: string, target: string, elapsedMs: number, reducedMotion = false): string {
  if (reducedMotion || elapsedMs >= 160 || target === current) return target;
  const prefix = target.startsWith(current) ? current : "";
  const rest = target.slice(prefix.length);
  const minimum = Math.max(1, Math.ceil(rest.length * .4));
  if (typeof Intl.Segmenter === "function") {
    for (const word of new Intl.Segmenter(undefined, { granularity: "word" }).segment(rest)) {
      const end = word.index + word.segment.length;
      if (end >= minimum) return prefix + rest.slice(0, end);
    }
  }
  const points = Array.from(rest);
  return prefix + points.slice(0, Math.max(1, Math.ceil(points.length * .4))).join("");
}

export type TextBlock = { kind: "paragraph" | "heading" | "quote"; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] };

/** A deliberately small display grammar. Never interprets HTML or runs model output. */
export function textBlocks(text: string, assistant = false): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const separator = assistant && /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
    if (!line.trim() || separator) { const last = blocks.at(-1); if (last?.kind === "paragraph") last.text += "\n"; continue; }
    const item = /^\s{0,3}(?:([-+*])|(\d{1,3})[.)])\s+(.+)$/.exec(line);
    if (item) {
      const ordered = Boolean(item[2]), previous = blocks.at(-1);
      if (previous?.kind === "list" && previous.ordered === ordered) previous.items.push(item[3]);
      else blocks.push({ kind: "list", ordered, start: item[2] ? Number(item[2]) : 1, items: [item[3]] });
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line), quote = /^>\s?(.*)$/.exec(line);
    if (heading || quote) { blocks.push({ kind: heading ? "heading" : "quote", text: (heading ?? quote)![1] }); continue; }
    const previous = blocks.at(-1);
    if (previous?.kind === "paragraph" && !/\n$/.test(previous.text)) previous.text += `\n${line}`;
    else blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
}

/** Only prose is restyled. Code and link tokens keep their exact original bytes. */
export function assistantProseText(text: string): string {
  return text.replace(/([^\s])[ \t]*\u2014[ \t]*/g, "$1, ").replace(/\u2014[ \t]*/g, "");
}

export type InlinePart = { kind: "text" | "strong" | "code"; text: string } | { kind: "link"; text: string; href: string };
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const token = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)/g;
  let cursor = 0;
  for (const match of text.matchAll(token)) {
    const at = match.index!;
    if (at > cursor) parts.push({ kind: "text", text: text.slice(cursor, at) });
    if (match[1]) parts.push({ kind: "code", text: match[1] });
    else if (match[2]) parts.push({ kind: "strong", text: match[2] });
    else {
      const raw = match[4] ?? match[5];
      const href = match[4] ? raw : raw.replace(/[.,;!?]+$/, "");
      try {
        const url = new URL(href);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error();
        parts.push({ kind: "link", text: match[3] ?? href, href });
        if (href.length < raw.length) parts.push({ kind: "text", text: raw.slice(href.length) });
      } catch { parts.push({ kind: "text", text: match[0] }); }
    }
    cursor = at + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) });
  return parts;
}
