// Local release operator. Signed transactions stay in a private journal, never
// in a web response or a repository artifact. Callers supply reviewed requests.
import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { keccak256, parseTransaction, recoverTransactionAddress, toHex } from "viem";

const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
const number = value => BigInt(value ?? 0);
async function durable(path, value, create = false) {
  const temporary = create ? path : `${path}.${process.pid}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(json(value)); await file.sync(); } finally { await file.close(); }
  if (!create) await rename(temporary, path);
  const directory = await open(join(path, ".."), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

export function maximumCost(record) {
  if (record.receipt) return number(record.receipt.gasUsed) * number(record.receipt.effectiveGasPrice)
    + (number(record.receipt.status) === 1n ? number(record.transaction.value) : 0n);
  return number(record.transaction.value) + number(record.transaction.gas) * number(record.transaction.gasPrice);
}

export async function sendOnce({ directory, id, account, chainId, transaction, rpcs,
  totalCap, chainCap, expectedAddress = null, expectedRuntime = null, expiresAt = null }) {
  if (!/^[a-z0-9-]{1,90}$/.test(id) || ![1,4663].includes(chainId) || rpcs.length !== 2) throw Error("Invalid release request");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await stat(directory)).mode & 0o077) throw Error("The transaction journal must be private");
  const lock = join(directory, "sender.lock");
  const held = await open(lock, "wx", 0o600);
  await held.writeFile(json({ pid: process.pid, id })); await held.sync();
  const path = join(directory, `${id}.json`);
  const request = { from: account.address.toLowerCase(), to: transaction.to?.toLowerCase() ?? null,
    data: transaction.data.toLowerCase(), value: number(transaction.value).toString(),
    gas: number(transaction.gas).toString(), nonce: number(transaction.nonce).toString(), chainId };
  try {
    const chainIds = await Promise.all(rpcs.map(rpc => rpc("eth_chainId", [])));
    if (chainIds.some(value => number(value) !== BigInt(chainId))) throw Error("Wrong release network");
    let record;
    try { record = JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (record && (json(record.request) !== json(request) || record.expectedAddress !== expectedAddress
      || record.expectedRuntime !== expectedRuntime || record.expiresAt !== expiresAt)) throw Error("Saved request differs; do not sign again");
    if (!record) {
      if (expiresAt !== null && expiresAt <= Math.floor(Date.now()/1000)+5) throw Error("Release request expired before signing");
      const nonces = await Promise.all(rpcs.flatMap(rpc => ["latest", "pending"].map(tag => rpc("eth_getTransactionCount", [account.address, tag]))));
      if (nonces.some(value => number(value) !== number(request.nonce))) throw Error("Account nonce changed or has pending work");
      const gasPrices = await Promise.all(rpcs.map(rpc => rpc("eth_gasPrice", [])));
      const gasPrice = gasPrices.map(number).reduce((a,b) => a > b ? a : b) * 13n / 10n + 1n;
      const unsigned = { to: request.to ?? undefined, data: request.data, value: number(request.value),
        gas: number(request.gas), nonce: Number(request.nonce), chainId, gasPrice, type: "legacy" };
      const estimateRequest = { from: account.address, ...(request.to ? { to: request.to } : {}),
        data: request.data, value: toHex(unsigned.value), nonce: toHex(unsigned.nonce) };
      const estimates = await Promise.all(rpcs.map(rpc => rpc("eth_estimateGas", [estimateRequest])));
      if (estimates.some(value => number(value) > unsigned.gas)) throw Error("Reviewed gas limit is insufficient");
      const previous = [];
      for (const file of await readdir(directory)) if (/^[a-z0-9-]+\.json$/.test(file)) previous.push(JSON.parse(await readFile(join(directory,file),"utf8")));
      if (previous.some(item => item.request.chainId === chainId && item.request.nonce === request.nonce)) throw Error("This nonce is already journaled");
      const reserve = unsigned.value + unsigned.gas * gasPrice;
      // Reserve the signed maximum even after mining; a reorg must never make
      // another transaction appear affordable by spending the old gas refund.
      const reserved = item => number(item.transaction.value) + number(item.transaction.gas) * number(item.transaction.gasPrice);
      const allCost = previous.reduce((sum,item) => sum + reserved(item), 0n);
      const networkCost = previous.filter(item => item.request.chainId === chainId).reduce((sum,item) => sum + reserved(item), 0n);
      if (allCost + reserve > totalCap || networkCost + reserve > chainCap) throw Error("The approved release spending cap would be exceeded");
      const balances = await Promise.all(rpcs.map(rpc => rpc("eth_getBalance", [account.address,"latest"])));
      if (balances.some(value => number(value) < reserve)) throw Error("Insufficient release balance");
      const raw = await account.signTransaction(unsigned);
      const parsed = parseTransaction(raw), sender = await recoverTransactionAddress({ serializedTransaction: raw });
      if (!same(sender, account.address) || parsed.chainId !== chainId || number(parsed.nonce) !== BigInt(unsigned.nonce)
        || !same(parsed.to, unsigned.to) || (parsed.data ?? "0x") !== unsigned.data || number(parsed.value) !== unsigned.value
        || parsed.gas !== unsigned.gas || parsed.gasPrice !== gasPrice) throw Error("Signed release request differs");
      record = { version:1, request, transaction: unsigned, expectedAddress, expectedRuntime, expiresAt, raw,
        hash: keccak256(raw), state:"signed", signedAt:new Date().toISOString() };
      await durable(path, record, true);
    }
    if (keccak256(record.raw) !== record.hash) throw Error("Signed journal integrity failed");
    const receipts = await Promise.all(rpcs.map(rpc => rpc("eth_getTransactionReceipt", [record.hash])));
    if (receipts.every(Boolean)) {
      const summary = receipt => ({ transactionHash:receipt.transactionHash, blockHash:receipt.blockHash,
        blockNumber:receipt.blockNumber, status:receipt.status, gasUsed:receipt.gasUsed,
        effectiveGasPrice:receipt.effectiveGasPrice, contractAddress:receipt.contractAddress });
      if (json(summary(receipts[0])) !== json(summary(receipts[1]))) throw Error("Receipt providers disagree");
      const receipt = receipts[0];
      if (!same(receipt.transactionHash,record.hash)) throw Error("Receipt hash differs");
      const blocks = await Promise.all(rpcs.map(rpc => rpc("eth_getBlockByNumber", [receipt.blockNumber,false])));
      if (blocks.some(block => !same(block?.hash,receipt.blockHash))) throw Error("Receipt is not canonical");
      if (expectedAddress && number(receipt.status) === 1n && !same(receipt.contractAddress,expectedAddress)) throw Error("Deployment address differs");
      if (expectedRuntime && number(receipt.status) === 1n) {
        const code = await Promise.all(rpcs.map(rpc => rpc("eth_getCode", [expectedAddress,{blockHash:receipt.blockHash,requireCanonical:true}])));
        if (code.some(value => keccak256(value) !== expectedRuntime)) throw Error("Deployed runtime differs");
      }
      record.receipt = receipt; record.state = number(receipt.status) === 1n ? "confirmed" : "reverted";
      await durable(path,record);
      return { hash:record.hash, state:record.state, receipt:summary(receipt), costWei:maximumCost(record).toString() };
    }
    if (receipts.some(Boolean)) return { hash:record.hash,state:"awaiting-provider-agreement" };
    // A persisted dispatch intent is never submitted twice by this operator.
    // Unknown outcomes keep the signed journal for independent reconciliation.
    if (record.state !== "signed") return { hash:record.hash,state:"pending" };
    const seen = await Promise.all(rpcs.map(rpc => rpc("eth_getTransactionByHash",[record.hash])));
    if (seen.some(Boolean)) { record.state="pending"; await durable(path,record); return {hash:record.hash,state:"pending"}; }
    if (expiresAt !== null && expiresAt <= Math.floor(Date.now()/1000)+5) throw Error("Signed request expired; preserve it for reconciliation");
    const currentNonces = await Promise.all(rpcs.flatMap(rpc => ["latest","pending"].map(tag => rpc("eth_getTransactionCount",[account.address,tag]))));
    if (currentNonces.some(value => number(value) !== number(request.nonce))) throw Error("Account nonce changed before dispatch; reconcile the signed request");
    record.state="dispatching";record.dispatchedAt=new Date().toISOString();await durable(path,record);
    try {
      const hash=await rpcs[0]("eth_sendRawTransaction",[record.raw]);
      if (!same(hash,record.hash)) throw Error("Submission hash differs");
      record.state="pending";
    } catch { record.state="uncertain"; }
    await durable(path,record);
    return {hash:record.hash,state:record.state};
  } finally { await held.close(); await unlink(lock); }
}
