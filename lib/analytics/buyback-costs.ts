import { date, number, PROJECT_WALLETS, type QueryResult } from "./model";

export type UnpricedBuyback = { hash: string; amount: number; at: string; block: number };
export type RelayBuybackInput = UnpricedBuyback & { address: string; networkId: 4663; timestamp: number; units: number };
const proxy = "0xccc88a9d1b4ed6b0eaba998850414b24f1c315be";
const router = "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
const v4 = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";
const usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const funds = "0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91";
const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const tracked = (address: string) => PROJECT_WALLETS.includes(address);

export function unpricedBuybacks(result: QueryResult): UnpricedBuyback[] {
  try {
  if (result.rows.length !== 1) return [];
  const row = result.rows[0], count = number(row?.unpriced_buybacks);
  if (!count || !Number.isInteger(count) || count > 20 || typeof row?.transaction_audit !== "string" || typeof row.buyback_events_v1 !== "string") return [];
  const events = new Map(row.buyback_events_v1.split(";").map(entry => {
    const [chain, hash, amount, at, block] = entry.split("|");
    return [`${chain}:${hash.toLowerCase()}`, { hash:`0x${hash.toLowerCase()}`, amount:number(amount), at:date(at), block:number(block) }] as const;
  }));
  const requests: UnpricedBuyback[] = [];
  for (const entry of row.transaction_audit.split(";")) {
    const [chain, hash, amount, spent, otherUsd] = entry.split("|");
    if (chain !== "4663" || number(spent) !== 0 || number(otherUsd) !== 0) continue;
    const event = events.get(`${chain}:${hash.toLowerCase()}`);
    if (!event || !/^0x[\da-f]{64}$/.test(event.hash) || event.amount === null || event.amount <= 0 || event.amount !== number(amount) || !event.at || !event.block || !Number.isSafeInteger(event.block)) return [];
    requests.push({ hash:event.hash, amount:event.amount, at:event.at, block:event.block });
  }
  return requests.length === count && new Set(requests.map(r=>r.hash)).size === count ? requests : [];
  } catch { return []; }
}

type Log = { address: string; topics: string[]; data: string; removed?: boolean };
const wordAddress = (data: string, index: number) => `0x${data.slice(2+index*64+24,2+(index+1)*64)}`.toLowerCase();
const wordAmount = (data: string, index: number) => BigInt(`0x${data.slice(2+index*64,2+(index+1)*64)}`);

// These receipts value purchases already admitted by the finalized Dune swap query.
// A delivery or an unrelated transfer alone cannot establish purchase cost.
export function decodeRelayBuybackInput(request: UnpricedBuyback, raw: unknown): RelayBuybackInput | null {
  try {
    const receipt = raw as { transactionHash?: string; status?: string; blockNumber?: string; to?: string; logs?: unknown[] };
    if (receipt.transactionHash?.toLowerCase() !== request.hash || receipt.status !== "0x1" || receipt.to?.toLowerCase() !== proxy || !receipt.blockNumber || Number(BigInt(receipt.blockNumber)) !== request.block || !Array.isArray(receipt.logs) || receipt.logs.length > 2000) return null;
    const logs = receipt.logs.map(value => {
      const l = value as Log;
      if (l.removed || typeof l.address !== "string" || !Array.isArray(l.topics) || l.topics.some(t=>typeof t !== "string" || !/^0x[\da-f]{64}$/i.test(t)) || typeof l.data !== "string" || !/^0x(?:[\da-f]{2})*$/i.test(l.data)) throw Error("Invalid receipt");
      return { address:l.address.toLowerCase(), topics:l.topics.map(t=>t.toLowerCase()), data:l.data.toLowerCase() };
    });
    const movements = logs.filter(l=>[proxy,router].includes(l.address) && l.topics[0] === funds);
    if (movements.length !== 2 || movements.some(l=>l.data.length < 258)) return null;
    const input = movements.find(l=>l.address === proxy && wordAddress(l.data,1) === router && wordAddress(l.data,2) === usdg);
    const output = movements.find(l=>l.address === router && wordAddress(l.data,0) === router && tracked(wordAddress(l.data,1)) && wordAddress(l.data,2) === v4);
    if (!input || !output || tracked(wordAddress(input.data,0))) return null;
    const transfers = logs.filter(l=>l.topics[0] === transfer && l.topics.length === 3 && l.data.length === 66).map(l=>({ asset:l.address, from:wordAddress(l.topics[1],0), to:wordAddress(l.topics[2],0), amount:wordAmount(l.data,0) }));
    const funding = wordAddress(input.data,0), paid = wordAmount(input.data,3);
    if (paid <= 0n || !transfers.some(t=>t.asset === usdg && t.from === funding && t.to === router && t.amount === paid) || !transfers.some(t=>t.asset === v4 && t.from === router && t.to === wordAddress(output.data,1) && t.amount === wordAmount(output.data,3))) return null;
    const received = transfers.filter(t=>t.asset === v4).reduce((sum,t)=>sum+(tracked(t.to)?t.amount:0n)-(tracked(t.from)?t.amount:0n),0n);
    if (Math.abs(Number(received)/1e18-request.amount) > Math.max(0.000001,request.amount*1e-12)) return null;
    const refunds = transfers.filter(t=>t.asset === usdg && !tracked(t.from) && (t.to === funding || tracked(t.to))).reduce((sum,t)=>sum+t.amount,0n);
    const units = Number(paid-refunds)/1e6;
    if (!Number.isFinite(units) || units <= 0) return null;
    return { ...request, address:usdg, networkId:4663, timestamp:Math.floor(Date.parse(request.at)/1000), units };
  } catch { return null; }
}

export function completeBuybackCosts(result: QueryResult, inputs: RelayBuybackInput[], prices: Record<string, unknown>): QueryResult {
  const requests = unpricedBuybacks(result), subtotal = number(result.rows[0]?.buybacks_priced_subtotal_usd);
  if (!requests.length || requests.length !== inputs.length || subtotal === null) return result;
  const costs = new Map<string, number>();
  for (let i=0;i<inputs.length;i++) {
    const input = inputs[i], expected = requests.find(r=>r.hash === input.hash);
    const rows = prices[`p${i}`], quote = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    const price = number(quote?.priceUsd), timestamp = number(quote?.timestamp);
    if (!expected || expected.at !== input.at || expected.amount !== input.amount || expected.block !== input.block || input.address !== usdg || input.networkId !== 4663 || input.timestamp !== Math.floor(Date.parse(input.at)/1000) || !Number.isFinite(input.units) || input.units <= 0 || quote?.address?.toLowerCase() !== usdg || quote.networkId !== 4663 || price === null || price <= 0 || timestamp === null || timestamp > input.timestamp || input.timestamp-timestamp > 86400) return result;
    const cost = input.units*price;
    if (!Number.isFinite(cost) || cost <= 0 || costs.has(input.hash)) return result;
    costs.set(input.hash,cost);
  }
  if (costs.size !== requests.length) return result;
  const total = subtotal+[...costs.values()].reduce((sum,cost)=>sum+cost,0);
  if (!Number.isFinite(total)) return result;
  const row = result.rows[0];
  const audit = String(row.transaction_audit).split(";").map(entry=>{
    const fields=entry.split("|"), cost=fields[0] === "4663" ? costs.get(`0x${fields[1].toLowerCase()}`) : undefined;
    if (cost !== undefined) fields[4]=String(cost);
    return fields.join("|");
  }).join(";");
  return { ...result, rows:[{ ...row, buybacks_usd:total, unpriced_buybacks:0, transaction_audit:audit }] };
}
