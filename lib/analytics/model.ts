export type Chain = "all" | "Ethereum" | "Robinhood";
export type Period = "all" | "7d" | "30d";
export type Row = Record<string, unknown>;
export type QueryResult = { updatedAt: string; rows: Row[]; available: boolean; stale?: boolean };
export type ActivityValue = { usd: number; amount: number; at: string };
export type AnalyticsData = { volume: QueryResult; revenue: QueryResult; buybacks: QueryResult; burns: QueryResult; activityValues?: Record<string, ActivityValue>; renderedAt?: number };
export const PROJECT_WALLETS = ["0x4957f49620aff3adbbe8195a4f633e49cc93376c", "0xd88539d3c4c460136a733a3fd60cf6bf269079da", "0x39544a7023081b56d7405c1af0bfaf72da7e24f6"];
// Original supply of the current Robinhood V4; the public contract is recorded in the analytics supply evidence.
// Transfers to a burn address do not reduce this original-supply denominator.
export const V4_INITIAL_SUPPLY = 1_000_000_000;
export const QUERY_IDS = { volume: 8940969, revenue: 8940998, buybacks: 8677080, burns: 8941418 } as const;
export const QUERY_COLUMNS = {
  volume: ["day","chain","category","volume_usd","unpriced_swaps","launched_tokens"],
  revenue: ["day","chain","priced_collected_subtotal_usd","unpriced_claims"],
  buybacks: ["v4_bought_back","legacy_eth_v4_bought_back","buyback_events_v1","buybacks_usd","unpriced_buybacks","transaction_audit"],
  burns: ["chain","burn_time_utc","transaction_hash","log_index","sender_address","v4_burned"],
} as const;
export type Activity = { kind: "Buyback" | "Burn"; chain: Exclude<Chain, "all">; hash: string; amount: number; at: string; usd?: number | null };
export const activityKey = (a: Activity) => `${a.kind}:${a.chain}:${a.hash}`;
export function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null;
}
export function date(value: unknown): string {
  if (typeof value !== "string") return "";
  const parsed = new Date(value.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}
export function decodeResult(raw: unknown): QueryResult {
  const j = raw as { state?: string; execution_ended_at?: string; next_offset?: number | null; result?: { rows?: Row[] } };
  if (j?.state !== "QUERY_STATE_COMPLETED" || !Array.isArray(j.result?.rows) || j.next_offset != null || !date(j.execution_ended_at)) throw new Error("Incomplete analytics result");
  return { rows: j.result.rows, updatedAt: date(j.execution_ended_at), available: true };
}
export function pickColumns(result: QueryResult, kind: keyof typeof QUERY_COLUMNS): QueryResult {
  const fields = QUERY_COLUMNS[kind];
  for (const row of result.rows) if (fields.some(f => !(f in row))) throw new Error("Analytics schema changed");
  return { ...result, rows: result.rows.map(row=>Object.fromEntries(fields.map(f=>[f,row[f]]))) };
}
function start(period: Period, now: number) {
  if (period === "all") return -Infinity;
  const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.getTime() - (period === "7d" ? 6 : 29) * 86400000;
}
function matches(chain: Chain, actual: unknown) { return chain === "all" || actual === chain; }
export function summarize(data: AnalyticsData, chain: Chain, period: Period, now = Date.now()) {
  const since = start(period, now);
  const select = (rows: Row[]) => rows.filter(r => matches(chain, r.chain) && new Date(date(r.day)).getTime() >= since);
  const volumeRows = select(data.volume.rows), feeRows = select(data.revenue.rows);
  const total = (rows: Row[], field: string) => rows.reduce((sum, row) => sum + (number(row[field]) ?? 0), 0);
  const dedup = new Map<string, Activity>();
  const add = (a: Activity) => { if (/^0x[\da-f]{64}$/i.test(a.hash) && a.at && Number.isFinite(a.amount)) dedup.set(`${a.kind}:${a.chain}:${a.hash}`, a); };
  const purchases = data.buybacks.rows[0];
  if (typeof purchases?.buyback_events_v1 === "string") for (const entry of purchases.buyback_events_v1.split(";")) {
    const [id, hash, amount, at] = entry.split("|");
    if (id === "1" || id === "4663") add({ kind: "Buyback", chain: id === "1" ? "Ethereum" : "Robinhood", hash: `0x${hash.toLowerCase()}`, amount: number(amount) ?? NaN, at: date(at) });
  }
  // Only transfers from the three project wallets contribute to project burns.
  const burnEvents = new Set<string>();
  for (const row of data.burns.rows) if (PROJECT_WALLETS.includes(String(row.sender_address).toLowerCase())) {
    const a: Activity = { kind: "Burn", chain: row.chain === "Ethereum" ? "Ethereum" : "Robinhood", hash: String(row.transaction_hash).toLowerCase(), amount: number(row.exact_v4_burned ?? row.v4_burned) ?? NaN, at: date(row.burn_time_utc) };
    const key = `${a.chain}:${a.hash}:${row.log_index}`;
    if (burnEvents.has(key)) continue;
    burnEvents.add(key);
    const existing = dedup.get(`Burn:${a.chain}:${a.hash}`);
    add({ ...a, amount: a.amount + (existing?.amount ?? 0) });
  }
  const activity = [...dedup.values()].filter(a => matches(chain, a.chain) && new Date(a.at).getTime() >= since).sort((a,b) => b.at.localeCompare(a.at)).map(a => {
    const value = data.activityValues?.[activityKey(a)];
    return { ...a, usd: value?.amount === a.amount && value.at === a.at ? number(value.usd) : null };
  });
  const purchaseSum = (c: Chain) => activity.filter(a => a.kind === "Buyback" && matches(c, a.chain)).reduce((s,a) => s+a.amount,0);
  const burnSum = (c: Chain) => activity.filter(a => a.kind === "Burn" && matches(c, a.chain)).reduce((s,a) => s+a.amount,0);
  const hasPurchaseEvents = typeof purchases?.buyback_events_v1 === "string";
  const currentBought = hasPurchaseEvents ? purchaseSum("Robinhood") : period === "all" ? number(purchases?.v4_bought_back) : null;
  const legacyBought = hasPurchaseEvents ? purchaseSum("Ethereum") : period === "all" ? number(purchases?.legacy_eth_v4_bought_back) : null;
  const currentBurned = data.burns.available ? burnSum("Robinhood") : null;
  const legacyBurned = data.burns.available ? burnSum("Ethereum") : null;
  return {
    volume: data.volume.available ? total(volumeRows,"volume_usd") : null,
    unpricedSwaps: total(volumeRows,"unpriced_swaps"),
    revenue: data.revenue.available ? total(feeRows,"priced_collected_subtotal_usd") : null,
    unpricedClaims: total(feeRows,"unpriced_claims"),
    bought: chain === "Ethereum" ? legacyBought : currentBought,
    // This source's historical USD total covers both chains. Never present a
    // priced subtotal (or a missing price) as the complete amount spent.
    buybackSpendUsd: data.buybacks.available && chain === "all" && period === "all"
      && number(purchases?.unpriced_buybacks) === 0 ? number(purchases?.buybacks_usd) : null,
    burned: chain === "Ethereum" ? legacyBurned : currentBurned,
    burnedSupplyPercent: chain === "Ethereum" || currentBurned === null ? null : currentBurned / V4_INITIAL_SUPPLY * 100,
    legacyBought, legacyBurned,
    launches: number(data.volume.rows[0]?.launched_tokens),
    activity,
    updatedAt: [data.volume,data.revenue,data.buybacks,data.burns].map(q=>q.updatedAt).filter(Boolean).sort()[0] ?? "",
    unavailable: [data.volume,data.revenue,data.buybacks,data.burns].some(q=>!q.available || q.stale),
  };
}
export function explorer(a: Activity) {
  return `${a.chain === "Ethereum" ? "https://etherscan.io" : "https://robinhoodchain.blockscout.com"}/tx/${a.hash}`;
}
