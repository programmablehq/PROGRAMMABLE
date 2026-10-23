export type KnowledgeSource = { title: string; url: string; retrievedAt: string };
export type KnowledgeLookup = { kind: "catalog" | "contract" | "web"; query: string; chainId: 1 | 4663; address: string };
export type KnowledgeResult = { status: string; facts: unknown; sources: KnowledgeSource[] };

export function safeKnowledgeSources(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).flatMap(item => {
    if (!item || typeof item.url !== "string" || typeof item.title !== "string" || typeof item.retrievedAt !== "string") return [];
    try {
      const url = new URL(item.url);
      if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2048) return [];
      return [{ title: item.title.slice(0, 180), url: url.href, retrievedAt: item.retrievedAt.slice(0, 40) }];
    } catch { return []; }
  });
}
