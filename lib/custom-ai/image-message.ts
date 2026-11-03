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
