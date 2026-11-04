/** Only unambiguous image-only edits bypass inference. Mixed design requests
 * stay in the normal chat so no rule or attached instruction is discarded. */
export function imageMessageURL(content: string): string | undefined {
  const text = content.trim();
  const links = [...text.matchAll(/https:\/\/[^\s<>]+/gu)];
  if (links.length !== 1) return;
  const url = links[0][0].replace(/[.,!]$/, "");
  let parsed: URL;
  try { parsed = new URL(url); } catch { return; }
  if (parsed.username || parsed.password || parsed.port || parsed.hash) return;
  const instruction = text.replace(links[0][0], "").trim();
  if (!instruction && /\.(?:png|jpe?g|webp|gif)$/iu.test(parsed.pathname)) return url;
  if (/^(?:(?:please|bitte)\s+)?(?:(?:use|set|change|replace|nimm|nutze|verwende|ändere|ersetze)\s+)?(?:(?:the|this|my|das|dieses|mein|meine)\s+)?(?:coin[- ]?)?(?:image|picture|logo|icon|bild)(?:\s+(?:to|with|is|auf|durch|ist))?\s*[:=]?$/iu.test(instruction)) return url;
}

/** An explicit image inside a longer request may be attached while the entire
 * message still goes through normal inference. Other project links stay text. */
export function explicitImageMessageURL(content: string): string | undefined {
  const candidates: string[]=[];
  for(const match of content.matchAll(/https:\/\/[^\s<>]+/gu)){
    const before=content.slice(Math.max(0,match.index!-70),match.index).trim();
    const after=content.slice(match.index!+match[0].length,match.index!+match[0].length+60);
    const labelled=/(?:image|picture|logo|icon|bild)\s*[:=]$/iu.test(before)
      || /(?:use|set|nimm|nutze|verwende)\s+(?:(?:this|the|dieses|das)\s+)?(?:coin[- ]?)?(?:image|picture|logo|icon|bild)\s*:?$/iu.test(before)
      || /(?:^|[.!?]\s+)(?:use|set|nimm|nutze|verwende)$/iu.test(before)
        && /^\s+(?:as|als)\s+(?:(?:the|its|my|das|sein|dein)\s+)?(?:coin[- ]?)?(?:image|picture|logo|icon|bild)\b/iu.test(after);
    if(!labelled||/\b(?:not|never|don't|nicht|kein)\b[^.!?]*$/iu.test(before))continue;
    const url=match[0].replace(/[.,!]$/,"");
    try{const parsed=new URL(url);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.port&&!parsed.hash)candidates.push(url);}catch{}
  }
  return candidates.length===1?candidates[0]:undefined;
}
