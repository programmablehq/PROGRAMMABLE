import {
  createPublicClient, decodeEventLog, decodeFunctionResult, encodeFunctionData,
  erc20Abi, getAddress, http, keccak256, multicall3Abi, parseAbi, toHex,
} from "viem";

// Shared deployment pins: lib/chains.ts and lib/module-foundation/constants.ts.
export const CHAIN_ID = 4663;
export const TREASURY = "0xD88539d3c4C460136a733A3Fd60cf6BF269079da";
export const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const MULTICALL_HASH = "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891";
export const MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
export const MANAGER_HASH = "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626";
export const RPC_URLS = ["https://rpc.mainnet.chain.robinhood.com", "https://rpc-robinhood.blockmachine.io"];
export const MAX_CLAIMS = 128;
const MAX_AMOUNT = (1n << 127n) - 1n;
const HASH = /^0x[0-9a-f]{64}$/i;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const need = (ok, message) => { if (!ok) throw new Error(message); };
const serialize = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);

const resultV1 = "struct LaunchResult { address token; address hook; address ledger; bytes32 poolId; address baseVault; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; }";
const resultV2 = "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }";
export const FACTORY_ABIS = Object.freeze({
  v1: parseAbi([resultV1, "function launchOf(address token) view returns (LaunchResult result)",
    "event FoundationLaunched(address indexed token,address indexed creator,bytes32 indexed poolId,address hook,address ledger,address quote,address baseVault,uint256 basePositionId,uint256 creatorPositionId,bytes32 metadataHash,bytes32 compositionHash,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount)"]),
  ...Object.fromEntries(["v2", "v3"].map(version => [version, parseAbi([resultV2,
    "function launchOf(address token) view returns (LaunchResultV2 result)",
    "event FoundationLaunched" + version.toUpperCase() + "(address indexed token,address indexed creator,bytes32 indexed poolId,address hook,address ledger,address quote,bytes32 metadataHash,bytes32 compositionHash,bytes32 custodyId,uint256 initialBuyQuoteAmount,LaunchResultV2 result)"])])),
});
export const LEDGER_ABI = parseAbi([
  "function poolManager() view returns (address)", "function hook() view returns (address)",
  "function quote() view returns (address)", "function creator() view returns (address)",
  "function platformReceived() view returns (uint256)", "function platformClaimed() view returns (uint256)",
  "function outstandingBacking() view returns (uint256)", "function claimPlatform() returns (uint256 amount)",
  "event QuoteClaimed(address indexed beneficiary,uint8 indexed budget,uint256 amount)",
]);
const HOOK_ABI = parseAbi(["function ledger() view returns (address)", "function initializer() view returns (address)",
  "function token() view returns (address)", "function quote() view returns (address)"]);
const BACKING_ABI = parseAbi(["function balanceOf(address owner,uint256 id) view returns (uint256)"]);
export const CLAIM_DATA = encodeFunctionData({ abi: LEDGER_ABI, functionName: "claimPlatform" });

export function createClients() {
  return RPC_URLS.map(url => createPublicClient({ transport: http(url, { timeout: 15000, retryCount: 1 }), batch: { multicall: false } }));
}

export function parseReleases(history, active) {
  need(history?.schemaVersion === "programmable.module-foundation.index-releases.v1" && Array.isArray(history.releases),
    "Die Launch-Historie konnte nicht geprüft werden.");
  const inputs = history.releases.map(entry => entry.binding);
  // A temporary launch pause must not prevent claims from historical factories.
  if (active?.available === true) inputs.push(active.binding);
  const found = new Map();
  for (const input of inputs) {
    const version = input?.factoryVersion ?? "v1";
    need(FACTORY_ABIS[version] && /^[a-f0-9]{40}$/i.test(input?.sourceCommit ?? "") &&
      HASH.test(input?.releaseDigest ?? "") && /^[1-9][0-9]*$/.test(String(input?.startBlock ?? "")),
    "Eine Launch-Version wird noch nicht unterstützt.");
    const address = getAddress(input.factory.address);
    need(BigInt(address) !== 0n && HASH.test(input.factory.runtimeCodeHash), "Die Factory ist nicht verifiziert.");
    const release = { ...input, factoryVersion: version, startBlock: BigInt(input.startBlock),
      factory: { address, runtimeCodeHash: input.factory.runtimeCodeHash } };
    const previous = found.get(address);
    const identity = item => serialize([item.factoryVersion, item.releaseDigest.toLowerCase(), item.sourceCommit, item.startBlock,
      item.factory.address.toLowerCase(), item.factory.runtimeCodeHash.toLowerCase(), item.lpCustodyId ?? null,
      item.hookDeployer?.address?.toLowerCase(), item.hookDeployer?.runtimeCodeHash?.toLowerCase()]);
    need(!previous || identity(previous) === identity(release), "Widersprüchliche Launch-Versionen.");
    found.set(address, release);
  }
  need(found.size > 0 && found.size <= 64, "Die Launch-Historie ist unvollständig.");
  return [...found.values()];
}

async function mapLimit(items, limit, action) {
  const output = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; output[index] = await action(items[index], index); }
  }));
  return output;
}

export async function checkpoint(clients) {
  const chains = await Promise.all(clients.map(client => client.getChainId()));
  need(chains.every(chain => chain === CHAIN_ID), "Die Verbindung ist nicht auf Robinhood Chain.");
  const heads = await Promise.all(clients.map(client => client.getBlockNumber({ cacheTime: 0 })));
  const number = heads.reduce((a, b) => a < b ? a : b) - 16n;
  const blocks = await Promise.all(clients.map(client => client.getBlock({ blockNumber: number })));
  need(blocks.every(block => block.number === number && block.hash && same(block.hash, blocks[0].hash)) &&
    Math.abs(Date.now() / 1000 - Number(blocks[0].timestamp)) < 120,
  "Die Netzwerkdaten sind nicht aktuell. Bitte erneut versuchen.");
  return { number, hash: blocks[0].hash, timestamp: blocks[0].timestamp };
}

async function pin(clients, address, hash, blockNumber) {
  const codes = await Promise.all(clients.map(client => client.getCode({ address, blockNumber })));
  need(codes.every(code => code && code !== "0x" && same(keccak256(code), hash)),
    "Ein Contract stimmt nicht mit der geprüften Version überein.");
}

async function readBoth(clients, calls, blockNumber) {
  const data = encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [
    calls.map(call => ({ target: call.address, allowFailure: false, callData: encodeFunctionData(call) })),
  ] });
  const replies = await Promise.all(clients.map(client => client.call({ to: MULTICALL, data, blockNumber })));
  need(replies[0].data && same(replies[0].data, replies[1].data), "Die Gebühren konnten nicht übereinstimmend geprüft werden.");
  const decoded = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: replies[0].data });
  need(decoded.length === calls.length && decoded.every(item => item.success), "Ein Gebührenkonto konnte nicht gelesen werden.");
  return decoded.map((item, index) => decodeFunctionResult({ ...calls[index], data: item.returnData }));
}

async function logsInRange(client, release, fromBlock, toBlock) {
  if (fromBlock > toBlock) return [];
  const abi = FACTORY_ABIS[release.factoryVersion];
  const event = abi.find(item => item.type === "event");
  try {
    const logs = await client.getLogs({ address: release.factory.address, event, fromBlock, toBlock, strict: true });
    if (logs.length >= 1000 && fromBlock < toBlock) throw new Error("Split dense range");
    need(logs.length < 1000, "Zu viele Launches in einem Block.");
    return logs;
  } catch (error) {
    if (fromBlock >= toBlock || !/range|too many|more than|response size|Split dense range/i.test(error.message)) throw error;
    const middle = (fromBlock + toBlock) / 2n;
    const left = await logsInRange(client, release, fromBlock, middle);
    return left.concat(await logsInRange(client, release, middle + 1n, toBlock));
  }
}

export function validateLedger(launch, values) {
  const [record, manager, hook, quote, creator, received, claimed, outstanding, backing,
    hookLedger, initializer, hookToken, hookQuote] = values;
  need(same(record.token, launch.token) && same(record.hook, launch.hook) && same(record.ledger, launch.ledger) &&
    same(record.poolId, launch.poolId) && same(manager, MANAGER) && same(hook, launch.hook) &&
    same(quote, launch.quote) && same(creator, launch.creator) && same(hookLedger, launch.ledger) &&
    same(initializer, launch.release.factory.address) && same(hookToken, launch.token) && same(hookQuote, launch.quote),
  "Ein Gebührenkonto gehört nicht zum erwarteten Launch.");
  need(received >= claimed && backing >= outstanding && outstanding >= received - claimed,
    "Die Gebühren sind nicht vollständig gedeckt.");
  const amount = received - claimed;
  need(amount <= MAX_AMOUNT, "Dieses Gebührenkonto benötigt mehrere Auszahlungen.");
  return { ...launch, received, claimed, amount };
}

/** All factory launches are included, including unlisted coins and previous releases. */
export async function scanFees({ clients, releases, progress = () => {}, minimumBlock = 0n }) {
  let block = await checkpoint(clients);
  for (let attempt = 0; block.number < minimumBlock && attempt < 12; attempt++) {
    progress("Auszahlung bestätigt. Gebühren werden aktualisiert…");
    await new Promise(resolve => setTimeout(resolve, 1000));
    block = await checkpoint(clients);
  }
  need(block.number >= minimumBlock, "Die Auszahlung ist bestätigt. Der neue Gebührenstand wird noch übernommen. Bitte erneut prüfen.");
  await Promise.all([
    pin(clients, MULTICALL, MULTICALL_HASH, block.number),
    pin(clients, MANAGER, MANAGER_HASH, block.number),
    ...releases.map(release => pin(clients, release.factory.address, release.factory.runtimeCodeHash, block.number)),
  ]);
  const groups = await mapLimit(releases, 4, async release => {
    progress("Launches werden geladen…");
    const logs = await logsInRange(clients[0], release, release.startBlock, block.number);
    return logs.map(log => {
      need(!log.removed && log.blockHash && log.transactionHash && log.blockNumber >= release.startBlock &&
        log.blockNumber <= block.number && same(log.address, release.factory.address), "Ungültiger Launch-Eintrag.");
      return { ...log.args, release, log };
    });
  });
  const launches = groups.flat();
  need(launches.length <= 4096, "Die Launch-Historie ist zu groß für einen einzelnen Durchlauf.");
  const identities = new Set();
  for (const launch of launches) {
    const key = getAddress(launch.ledger);
    need(!identities.has(key) && BigInt(key) !== 0n, "Ein Gebührenkonto wurde doppelt gefunden.");
    identities.add(key);
  }
  const checked = await mapLimit(launches, 4, async (launch, index) => {
    progress("Gebühren werden geprüft… " + (index + 1) + "/" + launches.length);
    // Verify each discovered event independently; the explorer and website lists are not claim authority.
    const receipt = await clients[1].getTransactionReceipt({ hash: launch.log.transactionHash });
    need(receipt.status === "success" && same(receipt.blockHash, launch.log.blockHash) &&
      receipt.logs.some(log => log.logIndex === launch.log.logIndex && same(log.address, launch.log.address) &&
        same(log.data, launch.log.data) && serialize(log.topics) === serialize(launch.log.topics)),
    "Ein Launch konnte auf der Chain nicht bestätigt werden.");
    const ledger = name => ({ address: launch.ledger, abi: LEDGER_ABI, functionName: name });
    const hook = name => ({ address: launch.hook, abi: HOOK_ABI, functionName: name });
    const values = await readBoth(clients, [
      { address: launch.release.factory.address, abi: FACTORY_ABIS[launch.release.factoryVersion], functionName: "launchOf", args: [launch.token] },
      ...["poolManager", "hook", "quote", "creator", "platformReceived", "platformClaimed", "outstandingBacking"].map(ledger),
      { address: MANAGER, abi: BACKING_ABI, functionName: "balanceOf", args: [launch.ledger, BigInt(launch.quote)] },
      ...["ledger", "initializer", "token", "quote"].map(hook),
    ], block.number);
    return validateLedger(launch, values);
  });
  const claims = checked.filter(item => item.amount > 0n);
  need(claims.length <= MAX_CLAIMS, "Mehr als 128 Gebührenkonten sind offen. Ein größerer Sammelclaim muss vorbereitet werden.");
  const assets = await mapLimit([...new Set(claims.map(item => getAddress(item.quote)))], 4, async address => {
    const [symbol, decimals] = await readBoth(clients, ["symbol", "decimals"].map(functionName => ({
      address, abi: erc20Abi, functionName,
    })), block.number);
    need(typeof symbol === "string" && symbol.length <= 64 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(symbol) &&
      Number.isInteger(decimals) && decimals >= 0 && decimals <= 36, "Die Währung eines Gebührenkontos konnte nicht gelesen werden.");
    return { address, symbol, decimals, amount: claims.filter(item => same(item.quote, address)).reduce((sum, item) => sum + item.amount, 0n) };
  });
  await assertCheckpoint(clients, block);
  return { block, claims, assets, launchCount: launches.length, scannedAt: Date.now() };
}

async function assertCheckpoint(clients, block) {
  const blocks = await Promise.all(clients.map(client => client.getBlock({ blockNumber: block.number })));
  need(blocks.every(item => same(item.hash, block.hash)), "Die Chain hat sich geändert. Bitte erneut prüfen.");
}

export function buildClaimTransaction(account, claims) {
  const from = getAddress(account);
  need(BigInt(from) !== 0n && claims.length > 0 && claims.length <= MAX_CLAIMS, "Keine gültigen offenen Gebühren.");
  const seen = new Set();
  const calls = claims.map(claim => {
    const target = getAddress(claim.ledger);
    need(BigInt(target) !== 0n && !seen.has(target) && claim.amount > 0n && claim.amount <= MAX_AMOUNT,
      "Ungültiger oder doppelter Gebühren-Claim.");
    seen.add(target);
    return { target, allowFailure: false, callData: CLAIM_DATA };
  });
  return { from, to: MULTICALL, value: "0x0",
    data: encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] }) };
}

export function verifySimulation(data, claims) {
  const results = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data });
  need(results.length === claims.length && results.every((result, index) => result.success &&
    decodeFunctionResult({ abi: LEDGER_ABI, functionName: "claimPlatform", data: result.returnData }) === claims[index].amount),
  "Die simulierte Auszahlung stimmt nicht mit den offenen Gebühren überein.");
}

/** The same single, zero-value transaction is simulated by both providers before the wallet handoff. */
export async function prepareClaim({ clients, snapshot, account }) {
  need(Date.now() - snapshot.scannedAt < 120000, "Bitte die Gebühren vor dem Claim aktualisieren.");
  const transaction = buildClaimTransaction(account, snapshot.claims);
  const results = await Promise.all(clients.map(client => client.call({
    account: transaction.from, to: transaction.to, data: transaction.data, value: 0n, blockNumber: snapshot.block.number,
  })));
  for (const result of results) verifySimulation(result.data, snapshot.claims);
  await assertCheckpoint(clients, snapshot.block);
  const estimates = await Promise.all(clients.map(client => client.estimateGas({
    account: transaction.from, to: transaction.to, data: transaction.data, value: 0n,
  })));
  const gas = estimates.reduce((a, b) => a > b ? a : b) * 125n / 100n;
  const [balance, gasPrice, nonce] = await Promise.all([
    clients[0].getBalance({ address: transaction.from }), clients[0].getGasPrice(),
    clients[0].getTransactionCount({ address: transaction.from, blockTag: "pending" }),
  ]);
  need(balance >= gas * gasPrice * 2n, "Für die Netzwerkgebühr fehlt ETH auf Robinhood Chain.");
  return { transaction: { ...transaction, gas: toHex(gas), chainId: toHex(CHAIN_ID), nonce: toHex(nonce) },
    snapshot, nonce, preparedAt: Date.now() };
}

export function verifyClaimReceipt(receipt, transaction, claims) {
  need(receipt.status === "success" && same(receipt.from, transaction.from) && same(receipt.to, MULTICALL),
    "Die Auszahlung wurde nicht erfolgreich bestätigt.");
  for (const claim of claims) {
    const events = receipt.logs.filter(log => same(log.address, claim.ledger)).flatMap(log => {
      try { return [decodeEventLog({ abi: LEDGER_ABI, eventName: "QuoteClaimed", data: log.data, topics: log.topics, strict: true }).args]; }
      catch { return []; }
    });
    need(events.length === 1 && same(events[0].beneficiary, TREASURY) && events[0].budget === 0 && events[0].amount > 0n,
      "Eine Auszahlung an die Treasury konnte nicht bestätigt werden.");
  }
  return true;
}

/** Recover a mined replacement after reload using the sender's exact prepared nonce. */
export async function findMinedClaimHash(clients, prepared) {
  const client = clients[0], address = prepared.transaction.from;
  const nonce = Number(BigInt(prepared.transaction.nonce));
  need(Number.isSafeInteger(nonce) && nonce >= 0, "Die gespeicherte Transaktion ist unvollständig.");
  let left = BigInt(prepared.snapshot.block.number), right = await client.getBlockNumber({ cacheTime: 0 });
  if (await client.getTransactionCount({ address, blockNumber: right }) <= nonce) return null;
  need(left <= right && await client.getTransactionCount({ address, blockNumber: left }) <= nonce,
    "Die gespeicherte Transaktion konnte nicht eindeutig zugeordnet werden.");
  while (left < right) {
    const middle = (left + right) / 2n;
    if (await client.getTransactionCount({ address, blockNumber: middle }) > nonce) right = middle;
    else left = middle + 1n;
  }
  const block = await client.getBlock({ blockNumber: left, includeTransactions: true });
  const matches = block.transactions.filter(transaction => same(transaction.from, address) && transaction.nonce === nonce);
  need(matches.length === 1 && HASH.test(matches[0].hash), "Die bestätigte Wallet-Transaktion ist noch nicht verfügbar.");
  return matches[0].hash;
}

export async function confirmClaim(clients, hash, prepared, { allowReplacement = false } = {}) {
  need((await Promise.all(clients.map(client => client.getChainId()))).every(chain => chain === CHAIN_ID),
    "Die Bestätigung gehört nicht zu Robinhood Chain.");
  const [transactions, receipts] = await Promise.all([
    Promise.all(clients.map(client => client.getTransaction({ hash }))),
    Promise.all(clients.map(client => client.getTransactionReceipt({ hash }))),
  ]);
  const transaction = transactions[0], expectedNonce = Number(BigInt(prepared.transaction.nonce));
  need(Number.isSafeInteger(expectedNonce) && transactions.every(item => same(item.hash, hash) &&
    same(item.from, prepared.transaction.from) && item.nonce === expectedNonce &&
    same(item.to, transaction.to) && same(item.input, transaction.input) && item.value === transaction.value),
  "Die bestätigte Transaktion stimmt nicht mit der gespeicherten Wallet-Anfrage überein.");
  const exactClaim = same(transaction.to, MULTICALL) && same(transaction.input, prepared.transaction.data) && transaction.value === 0n;
  need(exactClaim || allowReplacement, "Die bestätigte Transaktion stimmt nicht mit dem Sammelclaim überein.");
  need(receipts.every(receipt => same(receipt.blockHash, receipts[0].blockHash) && same(receipt.transactionHash, hash) &&
    receipt.blockNumber === receipts[0].blockNumber && receipt.status === receipts[0].status),
    "Die Bestätigung ist noch nicht auf beiden Verbindungen verfügbar.");
  const blocks = await Promise.all(clients.map(client => client.getBlock({ blockNumber: receipts[0].blockNumber })));
  need(blocks.every(block => same(block.hash, receipts[0].blockHash)), "Die Bestätigung ist noch nicht kanonisch.");
  if (!exactClaim) return { ...receipts[0], outcome: "replaced" };
  if (receipts.every(receipt => receipt.status === "reverted")) return receipts[0];
  receipts.forEach(receipt => verifyClaimReceipt(receipt, prepared.transaction, prepared.snapshot.claims));
  return receipts[0];
}

export const jsonStringify = serialize;
