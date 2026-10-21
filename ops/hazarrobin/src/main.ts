import '@fontsource-variable/geist';
import './styles.css';
import { runClaimQueue } from './claim-queue';
import { createDashboard, type Group, type GroupId } from './dashboard';
import { readSnapshot, claimFees, type WalletConnection } from './chain';
import { LOCKER, CLAIM_CALLDATA } from './config';
import type { PendingClaim } from './pending';
import { scanChain, connect, claimEcosystem, eligible, pending, checkPending, remember, walletRequestNotSent } from './ecosystem';

const groups: Group[] = [
  { id: 'v4', title: 'Programmable V4', description: 'LP-Gebühren unseres V4-Coins', network: 'Robinhood', chainId: 4663, busy: false, message: 'Noch nicht gescannt', error: '' },
  { id: 'robinhood', title: 'Robinhood Ecosystem', description: 'Module Mode und Custom Launches', network: 'Robinhood', chainId: 4663, busy: false, message: 'Noch nicht gescannt', error: '' },
  { id: 'ethereum', title: 'Ethereum Ecosystem', description: 'Module Mode und Custom Launches', network: 'Ethereum', chainId: 1, busy: false, message: 'Noch nicht gescannt', error: '' },
];
let wallet: WalletConnection | null = null;
let connection: Promise<WalletConnection | null> | null = null;
let claiming = false, claimAllRunning = false, notice = '';
let activeGroup: GroupId | null = null;
const scans = new Map<GroupId, Promise<void>>();
const groupById = (id: GroupId) => groups.find(group => group.id === id)!;
const update = createDashboard(document.querySelector<HTMLDivElement>('#app')!, groups, {
  connect: () => { void connectWallet(); },
  scanAll: () => { if (!claiming && !claimAllRunning && !connection) void scanAll(); },
  claimAll: () => { void claimAll(); },
  scan: id => { if (!claiming && !claimAllRunning && !connection) void scanGroup(groupById(id)); },
  claim: id => { if (!claimAllRunning) void claimGroup(groupById(id)); },
  recover: id => { void recover(id); },
});
function canClaim(group: Group) {
  if (group.busy || claiming || connection) return false;
  if (group.id === 'v4') return !!group.snapshot?.trusted && (group.snapshot.claimableEth > 0n || group.snapshot.claimableV4 > 0n);
  return !!group.scan?.claims.length && (!wallet || !!eligible(group.scan.claims, wallet.account).length);
}
function render() {
  update({ groups, wallet, connecting: !!connection, claiming, claimAllRunning, activeGroup, notice, claimable: new Set(groups.filter(canClaim).map(group => group.id)) });
}
const message = (error: unknown) => error instanceof Error ? (('shortMessage' in error ? String(error.shortMessage) : error.message).slice(0, 260)) : 'Bitte erneut versuchen.';

function connectWallet(): Promise<WalletConnection | null> {
  if (connection) return connection;
  const task = connect().then(value => {
    wallet = value; notice = 'Wallet verbunden.'; return value;
  }).catch(error => {
    notice = message(error); return null;
  });
  connection = task;
  render();
  void task.finally(() => { connection = null; render(); });
  return task;
}
function scanGroup(group: Group, forClaim = false): Promise<void> {
  const existing = scans.get(group.id);
  if (existing) return existing;
  if (group.busy || claiming && !forClaim) return Promise.resolve();
  const task = (async () => {
    group.busy = true; group.error = ''; group.message = 'Gebühren werden geprüft…'; render();
    try {
      if (group.id === 'v4') {
        group.snapshot = await readSnapshot();
        if (!group.snapshot.trusted) throw Error('LP-Vertragsprüfung fehlgeschlagen. Auszahlung pausiert.');
        group.message = 'LP-Gebühren live gelesen.';
      } else {
        group.scan = await scanChain(group.chainId, value => { group.message = value; render(); });
        group.message = group.scan.complete ? 'Alle unterstützten Quellen geprüft.' : group.scan.issues.length ? 'Ein Teil der Quellen ist noch nicht erreichbar.' : 'Verfügbare Fees bereit. Details zur Prüfung unten.';
      }
    } catch (error) {
      group.error = message(error); group.scan = undefined; group.snapshot = undefined;
    } finally {
      group.busy = false; render();
    }
  })();
  const tracked = task.finally(() => { scans.delete(group.id); });
  scans.set(group.id, tracked);
  return tracked;
}
async function scanAll() {
  notice = '';
  await Promise.all(groups.map(group => scanGroup(group)));
}
async function recover(chainId: 1 | 4663) {
  if (claiming || claimAllRunning || connection) return;
  claiming = true; render();
  try { await checkPending(value => { notice = value; render(); }, chainId); }
  catch (error) { notice = message(error); }
  finally { claiming = false; render(); }
  if (!pending(chainId)) await Promise.all(groups.filter(group => group.chainId === chainId).map(group => scanGroup(group)));
}
async function claimGroup(group: Group, refreshAfter = true) {
  if (claiming || group.busy) return;
  // Hold the operation from the first click, including connection and refresh.
  claiming = true; activeGroup = group.id; group.error = ''; notice = '';
  group.message = wallet ? 'Auszahlung wird vorbereitet…' : 'Bitte MetaMask verbinden…'; render();
  let confirmed = false;
  try {
    // Keep this account bound to this operation even if the global wallet changes.
    const current = wallet ?? await connectWallet();
    if (!current) return;
    if (pending(group.chainId)) {
      await checkPending(value => { notice = value; render(); }, group.chainId);
      // The recovered transaction may already have paid some of these fees.
      // Refresh this group before preparing any further wallet request.
      group.scan = undefined; group.snapshot = undefined;
    }
    if (group.id !== 'v4' && (!group.scan || Date.now() - group.scan.scannedAt > 90000)) {
      group.message = 'Aktuelle Gebühren werden geprüft…'; render();
      await scanGroup(group, true);
      if (!group.scan) return;
    }
    if (group.id !== 'v4' && !eligible(group.scan!.claims, current.account).length) {
      group.message = 'Keine weiteren Gebühren für diese Wallet offen.';
      return;
    }
    group.busy = true; group.message = 'Auszahlung wird vorbereitet…'; render();
    if (group.id === 'v4') {
      let nonce = 0;
      await claimFees(current, progress => {
        if (progress.nonce !== undefined) nonce = progress.nonce;
        group.message = progress.stage === 'wallet' ? 'In MetaMask bestätigen…' : progress.stage === 'confirmed' ? 'Claim bestätigt.' : 'Auf Bestätigung warten…';
        const entry: PendingClaim = { chainId: 4663, account: current.account, to: LOCKER, data: CLAIM_CALLDATA, nonce, created: Date.now() };
        if (progress.stage === 'wallet') remember(entry);
        if (progress.hash) remember({ ...entry, hash: progress.hash });
        render();
      });
      remember(null, group.chainId);
    } else {
      const result = await claimEcosystem(group.scan!, current, value => { group.message = value; render(); });
      if (result.remaining) notice = `${result.count} Konten ausgezahlt. Für ${result.remaining} weitere bitte die Empfänger-Wallet verbinden.`;
    }
    if (group.scan) group.scan = { ...group.scan, claims: group.scan.claims.filter(claim => !eligible([claim], current.account).length) };
    if (group.snapshot) group.snapshot = { ...group.snapshot, claimableEth: 0n, claimableV4: 0n };
    confirmed = true; group.message = 'Auszahlung bestätigt.';
    if (!notice || notice === 'Wallet verbunden.') notice = `${group.title}: Fees ausgezahlt.`;
  } catch (error) {
    if (walletRequestNotSent(error)) remember(null, group.chainId);
    group.error = message(error); notice = group.error;
  } finally {
    group.busy = false; claiming = false; activeGroup = null; render();
  }
  if (confirmed && refreshAfter) await scanGroup(group);
}
async function claimAll() {
  if (claimAllRunning || claiming || connection) return;
  claimAllRunning = true; render();
  try {
    // One connection prompt for the queue; rejection must not open it again
    // for every group in turn.
    if (!wallet && !await connectWallet()) return;
    await runClaimQueue(groups, {
      scanning: group => scans.has(group.id), wait: group => scans.get(group.id) ?? Promise.resolve(),
      eligible: canClaim, chain: group => group.chainId, claim: group => claimGroup(group, false),
      failed: group => !!group.error || !!pending(group.chainId),
    });
  } finally {
    claimAllRunning = false; render();
  }
  await Promise.all(groups.filter(group => !group.error && !pending(group.chainId)).map(group => scanGroup(group)));
}
window.ethereum?.on?.('accountsChanged', () => {
  wallet = null; notice = 'Wallet gewechselt. Bitte erneut verbinden.'; render();
});
render(); void scanAll();
