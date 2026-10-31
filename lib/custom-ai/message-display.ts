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
