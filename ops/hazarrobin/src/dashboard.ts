import { formatUnits } from 'viem';
import type { ChainSnapshot, WalletConnection } from './chain';
import { FEE_RECIPIENT, TOKEN_ID } from './config';
import { pendingClaims, totals, type Scan, type FeeClaim } from './ecosystem';

export type GroupId = 'v4' | 'robinhood' | 'ethereum';
export interface Group {
  id: GroupId;
  title: string;
  description: string;
  network: string;
  chainId: 1 | 4663;
  busy: boolean;
  message: string;
  error: string;
  scan?: Scan;
  snapshot?: ChainSnapshot;
}
interface DashboardState {
  groups: Group[];
  wallet: WalletConnection | null;
  connecting: boolean;
  claiming: boolean;
  claimAllRunning: boolean;
  activeGroup: GroupId | null;
  notice: string;
  claimable: Set<GroupId>;
}
interface Actions {
  connect(): void;
  scanAll(): void;
  claimAll(): void;
  scan(id: GroupId): void;
  claim(id: GroupId): void;
  recover(chainId: 1 | 4663): void;
}
const PAGE_SIZE = 25;
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const explorer = (id: number) => id === 1 ? 'https://etherscan.io' : 'https://robinhoodchain.blockscout.com';
const number = (value: number) => value.toLocaleString('de-DE');
function amount(raw: bigint, decimals = 18) {
  if (!raw) return '0';
  const [whole, fraction = ''] = formatUnits(raw, decimals).split('.');
  if (whole === '0' && fraction.search(/[1-9]/) >= 6) return '< 0.000001';
  return (whole + (fraction ? '.' + fraction.slice(0, 6).replace(/0+$/, '') : '')).replace(/\.$/, '');
}
function text(node: HTMLElement, value: string) {
  if (node.textContent !== value) node.textContent = value;
}
function values(group: Group) {
  if (group.snapshot) return [
    { symbol: 'ETH', decimals: 18, amount: group.snapshot.claimableEth },
    { symbol: 'V4', decimals: 18, amount: group.snapshot.claimableV4 },
  ];
  return group.scan?.claims.length ? totals(group.scan.claims) : [{ symbol: 'ETH', decimals: 18, amount: 0n }];
}
function claimRow(claim: FeeClaim) {
  const assets = [claim, ...claim.additionalAssets ?? []];
  return `<div><span>${escape(claim.source)}</span><b>${assets.map(asset => `${escape(amount(BigInt(asset.amount), asset.decimals))} ${escape(asset.symbol)}`).join(' + ')}</b><a href="${explorer(claim.chainId)}/address/${claim.to}" target="_blank" rel="noreferrer">${short(claim.to)}</a></div>`;
}

/** Mount controls once. Streaming progress only updates text and button state;
 * fee totals and long lists are rebuilt only when their source result changes. */
export function createDashboard(app: HTMLDivElement, groups: Group[], actions: Actions) {
  app.innerHTML = `<header><a class="brand" href="https://programmable.market" target="_blank" rel="noreferrer"><img src="/programmable.png" alt=""/><span>programmable<span class="brand-sub">fee claims</span></span></a><button class="wallet" id="connect"><span class="wallet-dot"></span><span class="label">Wallet verbinden</span></button></header>
  <main><div class="hero"><div><span class="eyebrow">HAZARROBIN</span><h1>Alle Fees.<br><span>Ein Ablauf.</span></h1><p>Robinhood und Ethereum. ETH und Token direkt<br>an die hinterlegten Wallets auszahlen.</p></div><div class="hero-controls"><div class="hero-actions"><button id="claim-all" class="primary" disabled><span class="label">Alles claimen</span><span aria-hidden="true">↗</span></button><button id="scan-all" class="outline"><span class="label">Aktualisieren</span><span aria-hidden="true">↻</span></button></div><p id="scan-status" role="status"></p></div></div>
  <div id="notice" class="notice" role="status"></div><div id="pending"></div>
  <div class="grid">${groups.map((group, index) => `<section class="card idle" id="card-${group.id}" aria-labelledby="title-${group.id}"><div class="card-top"><span class="number">0${index + 1}</span><span class="network">${escape(group.network)}</span></div><h2 id="title-${group.id}">${escape(group.title)}</h2><p class="description">${escape(group.description)}</p><div class="amounts"><div class="amount"><strong>—</strong><span>Gebühren</span></div><p class="asset-caption">Wird geprüft</p></div><p class="coverage"></p><div class="status-line"><span class="dot"></span><span class="status-text"></span></div><p class="progress" id="progress-${group.id}"></p><button class="claim primary" data-claim="${group.id}" aria-describedby="progress-${group.id}" disabled><span class="label">Fees claimen</span><span aria-hidden="true">↗</span></button><button class="secondary scan-one" data-scan="${group.id}">Aktualisieren</button><details class="assets" data-assets="${group.id}" hidden><summary></summary><div class="asset-list"></div></details><details class="details" data-details="${group.id}" hidden><summary>Konten und Prüfung</summary><div class="details-body"></div></details></section>`).join('')}</div>
  <p class="footnote">Kein Mindestbetrag. Keine Token-Freigabe. Je nach Anzahl der Konten sind mehrere Wallet-Bestätigungen nötig.</p>
  </main><footer><span>Programmable Treasury</span><div><a href="/privacy.html">Datenschutz</a><a href="/terms.html">Hinweise</a></div></footer>`;
  const get = <T extends HTMLElement = HTMLElement>(selector: string, parent: ParentNode = app) => parent.querySelector<T>(selector)!;
  const cards = new Map(groups.map(group => {
    const root = get(`#card-${group.id}`);
    return [group.id, {
      group, root, scan: undefined as Scan | undefined, snapshot: undefined as ChainSnapshot | undefined,
      amount: get('.amount strong', root), symbol: get('.amount span', root), caption: get('.asset-caption', root),
      coverage: get('.coverage', root), status: get('.status-text', root), progress: get('.progress', root),
      claim: get<HTMLButtonElement>('[data-claim]', root), refresh: get<HTMLButtonElement>('[data-scan]', root),
      assets: get<HTMLDetailsElement>('.assets', root), assetList: get('.asset-list', root),
      details: get<HTMLDetailsElement>('.details', root), body: get('.details-body', root),
      totals: [] as ReturnType<typeof values>, rows: 0,
    }];
  }));
  type Card = NonNullable<ReturnType<typeof cards.get>>;
  function showAssets(card: Card) {
    if (!card.assets.open || card.assetList.childElementCount) return;
    card.assetList.innerHTML = card.totals.map(value => `<div><span>${escape(value.symbol)}</span><b>${escape(amount(value.amount, value.decimals))}</b></div>`).join('');
  }
  function showDetails(card: Card) {
    if (!card.details.open || card.body.childElementCount || !card.group.scan && !card.group.snapshot) return;
    const group = card.group;
    const recipients = group.id === 'v4' ? [FEE_RECIPIENT] : [...new Set(group.scan?.claims.map(claim => claim.recipient) ?? [])];
    card.body.innerHTML = `${group.id === 'v4' ? `<p>LP-Position ${TOKEN_ID}. Die Liquidität bleibt gesperrt; ausgezahlt werden nur Gebühren.</p>` : `<p>Stand: Block ${escape(group.scan?.blockNumber)}.</p>`}
    ${recipients.map(recipient => `<div class="recipient"><span>Empfänger</span><a href="${explorer(group.chainId)}/address/${recipient}" target="_blank" rel="noreferrer">${short(recipient)}</a></div>`).join('')}
    ${group.scan?.claims.some(claim => !claim.permissionless) ? '<p>Einige ältere Konten benötigen die jeweilige Empfänger-Wallet.</p>' : ''}
    ${group.scan?.issues.map(issue => `<p class="warning">${escape(issue.source)}: ${escape(issue.message)}</p>`).join('') ?? ''}
    ${group.scan?.blockedClaims?.length ? `<p class="warning">${number(group.scan.blockedClaims.length)} weitere Konten sind derzeit nicht auszahlbar. Die übrigen Fees kannst du claimen.</p>${group.scan.blockedClaims.map(({ claim, reason }) => `<p>${escape(amount(BigInt(claim.amount), claim.decimals))} ${escape(claim.symbol)} · ${escape(reason)}</p>`).join('')}` : ''}
    ${group.scan?.unsupported.length ? `<p class="warning">${number(group.scan.unsupported.length)} Custom-Verträge benötigen einen zusätzlichen Claim-Adapter. Diese Ansprüche sind noch nicht als claimbar bestätigt.</p>` : ''}
    ${group.scan?.claims.length ? `<div class="claim-list"></div><button class="secondary more-claims" data-more="${group.id}"></button>` : ''}`;
    card.rows = 0;
    showMore(card);
  }
  function showMore(card: Card) {
    const list = card.body.querySelector('.claim-list');
    if (!list || !card.group.scan) return;
    const claims = card.group.scan.claims;
    const next = Math.min(card.rows + PAGE_SIZE, claims.length);
    list.insertAdjacentHTML('beforeend', claims.slice(card.rows, next).map(claimRow).join(''));
    card.rows = next;
    const button = get<HTMLButtonElement>('[data-more]', card.body);
    button.disabled = next === claims.length;
    text(button, next === claims.length ? `Alle ${number(next)} Konten angezeigt` : `${number(next)} von ${number(claims.length)} Konten · Weitere anzeigen`);
  }
  app.addEventListener('toggle', event => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    const card = cards.get((details.dataset.assets ?? details.dataset.details) as GroupId);
    if (card) details.dataset.assets ? showAssets(card) : showDetails(card);
  }, true);
  app.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.id === 'connect') actions.connect();
    else if (button.id === 'scan-all') actions.scanAll();
    else if (button.id === 'claim-all') actions.claimAll();
    else if (button.dataset.claim) actions.claim(button.dataset.claim as GroupId);
    else if (button.dataset.scan) actions.scan(button.dataset.scan as GroupId);
    else if (button.dataset.pending) actions.recover(Number(button.dataset.pending) as 1 | 4663);
    else if (button.dataset.more) showMore(cards.get(button.dataset.more as GroupId)!);
  });
  let previousPending = '';
  return (state: DashboardState) => {
    const locked = state.claiming || state.claimAllRunning || state.connecting;
    const loading = groups.filter(group => group.busy && group.id !== state.activeGroup);
    const connect = get<HTMLButtonElement>('#connect');
    connect.disabled = locked;
    text(get('.label', connect), state.connecting ? 'In MetaMask bestätigen…' : state.wallet ? short(state.wallet.account) : 'Wallet verbinden');
    get('.wallet-dot', connect).classList.toggle('connected', !!state.wallet);
    const claimAll = get<HTMLButtonElement>('#claim-all');
    claimAll.disabled = locked || !state.claimable.size;
    text(get('.label', claimAll), state.claimAllRunning ? 'Claims laufen…' : 'Alles claimen');
    const scanAll = get<HTMLButtonElement>('#scan-all');
    scanAll.disabled = locked || loading.length > 0;
    text(get('.label', scanAll), loading.length ? 'Wird aktualisiert…' : 'Aktualisieren');
    const checked = groups.filter(group => !group.busy && (group.scan || group.snapshot)).length;
    text(get('#scan-status'), state.connecting ? 'Bitte die Verbindung in MetaMask bestätigen.' : state.claimAllRunning ? state.activeGroup ? `${groups.find(group => group.id === state.activeGroup)!.title} wird ausgezahlt.` : 'Bereite Fees zuerst, weitere nach dem Scan.' : loading.length ? `${checked} von 3 Bereichen geprüft · Scan läuft` : `${checked} von 3 Bereichen geprüft${groups.some(group => group.error || group.scan && !group.scan.complete) ? ' · Hinweise in den Karten' : ''}`);
    const notice = get('#notice');
    text(notice, state.notice); notice.classList.toggle('visible', !!state.notice);
    const entries = pendingClaims();
    const pendingKey = JSON.stringify(entries);
    if (pendingKey !== previousPending) {
      previousPending = pendingKey;
      get('#pending').innerHTML = entries.map(entry => `<div class="pending">${entry.chainId === 1 ? 'Ethereum' : 'Robinhood'}: Vorherigen Auftrag prüfen. ${entry.hash ? `<a href="${explorer(entry.chainId)}/tx/${entry.hash}" target="_blank" rel="noreferrer">Transaktion ansehen</a> · ` : ''}<button data-pending="${entry.chainId}">Status prüfen</button></div>`).join('');
    }
    get('#pending').querySelectorAll('button').forEach(button => { button.disabled = locked; });
    for (const group of groups) {
      const card = cards.get(group.id)!;
      const loaded = !!(group.scan || group.snapshot);
      const active = state.activeGroup === group.id;
      const incomplete = group.scan && !group.scan.complete;
      const status = group.busy || active ? 'scan' : group.error || incomplete ? 'partial' : loaded ? 'ready' : 'idle';
      if (card.root.className !== `card ${status}`) card.root.className = `card ${status}`;
      text(card.status, active ? 'Claim läuft' : group.busy ? 'Scan läuft' : group.error ? 'Erneut prüfen' : incomplete ? 'Hinweise zur Prüfung' : loaded ? 'Geprüft' : 'Bereit zum Scan');
      text(card.progress, group.error || group.message);
      card.claim.disabled = locked || !state.claimable.has(group.id);
      text(get('.label', card.claim), active ? 'Claim läuft…' : group.busy ? 'Wird gescannt…' : loaded && !card.totals.some(value => value.amount > 0n) && card.scan === group.scan && card.snapshot === group.snapshot ? 'Keine offenen Fees' : 'Fees claimen');
      card.refresh.disabled = locked || group.busy;
      if (card.scan === group.scan && card.snapshot === group.snapshot) continue;
      card.scan = group.scan; card.snapshot = group.snapshot;
      card.totals = values(group).filter(value => value.amount > 0n);
      const lead = card.totals.find(value => value.symbol === 'ETH') ?? card.totals[0];
      text(card.amount, loaded ? lead ? amount(lead.amount, lead.decimals) : '0' : '—');
      text(card.symbol, loaded ? lead?.symbol ?? 'ETH' : 'Gebühren');
      text(card.caption, !loaded ? 'Scan nicht abgeschlossen' : card.totals.length > 1 ? `+ ${number(card.totals.length - 1)} weitere Token` : card.totals.length ? 'Zur Auszahlung bereit' : incomplete ? 'Noch kein geprüfter Betrag' : 'Keine offenen Fees');
      text(card.coverage, group.scan ? `${number(group.scan.launchCount)} Launches · ${number(group.scan.claims.length)} Gebührenkonten` : loaded ? 'V4 LP-Position' : '');
      if (!active && !group.busy) text(get('.label', card.claim), loaded && !card.totals.length ? 'Keine offenen Fees' : 'Fees claimen');
      card.assets.hidden = !loaded || card.totals.length < 2;
      text(get('summary', card.assets), `Alle ${number(card.totals.length)} Währungen`);
      card.assetList.replaceChildren(); showAssets(card);
      card.details.hidden = !loaded;
      card.body.replaceChildren(); showDetails(card);
    }
  };
}
