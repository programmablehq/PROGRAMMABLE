import { once } from 'node:events';
import type { Server } from 'node:http';
import { expect, test } from '@playwright/test';
// @ts-expect-error Executable fixture with no production provider calls.
import { createExploreVisibilityServer } from './fixtures/explore-visibility-server.mjs';
let server: Server, origin: string;
test.beforeAll(async () => {
  server = await createExploreVisibilityServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address=server.address(); if(!address||typeof address==='string') throw Error('Fixture did not start');
  origin=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async()=>{if(server){server.close(); await once(server,'close');}});

test('embedded Explore loads on approach, pauses offscreen, and reuses its recent result',async({page})=>{
  let requests=0; page.on('request',r=>{if(new URL(r.url()).pathname==='/api/explore/launches') requests++;});
  await page.clock.install(); await page.goto(origin);
  await expect(page.getByRole('heading',{name:'Explore',exact:true})).toHaveCount(1);
  await page.clock.runFor(31_000); expect(requests).toBe(0);
  await page.getByRole('heading',{name:'Explore',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'No launches yet',exact:true})).toBeVisible(); expect(requests).toBe(1);
  await page.getByRole('heading',{name:'Introduction',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'Explore',exact:true})).not.toBeInViewport();
  await page.clock.runFor(1_000);
  await page.getByRole('heading',{name:'Explore',exact:true}).scrollIntoViewIfNeeded();
  await page.clock.runFor(1_000); expect(requests).toBe(1);
  await page.getByRole('heading',{name:'Introduction',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'Explore',exact:true})).not.toBeInViewport();
  await page.clock.runFor(61_000); expect(requests).toBe(1);
  await page.getByRole('heading',{name:'Explore',exact:true}).scrollIntoViewIfNeeded();
  await expect.poll(()=>requests).toBe(2);
});
test('standalone Explore fetches immediately',async({page})=>{
  let requests=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/explore/launches')requests++;});
  await page.goto(origin+'?standalone'); await expect(page.getByRole('heading',{name:'No launches yet',exact:true})).toBeVisible();
  expect(requests).toBe(1);
});

function navigationPayload(url: URL) {
  const chain = Number(url.searchParams.get('chain')) || 0;
  const label = chain === 8453 ? 'Base' : chain === 1 ? 'Ethereum' : chain === 4663 ? 'Robinhood' : 'All';
  const total = chain === 8453 ? 1 : 20;
  const number = Math.min(Number(url.searchParams.get('page') || 1), Math.ceil(total / 10));
  const rows = Array.from({length: total}, (_, index) => ({
    chainId: chain || (index % 2 ? 1 : 4663), mode: 'custom', category: 'custom',
    launchId: '0x' + String(index + 1).padStart(64, '0'), tokenAddress: '0x' + String(index + 1).padStart(40, '0'),
    hookAddress: '0x' + '11'.repeat(20), creator: '0x' + '22'.repeat(20),
    transactionHash: '0x' + '33'.repeat(32), blockNumber: '100',
    launchedAt: '2026-10-13T10:00:00Z', name: `${label} ${index + 1}`, symbol: `T${index + 1}`, decimals: 18,
  }));
  return {scope: 'all', status: 'ready', updatedAt: new Date().toISOString(),
    items: rows.slice((number - 1) * 10, number * 10), presentations: [],
    page: {number, size: 10, totalItems: total, totalPages: Math.ceil(total / 10), hasMore: number * 10 < total}};
}

for (const width of [1440, 390]) {
  test(`cached chain changes restore immediately without another fetch at ${width}px`, async ({page}) => {
    const requests: string[] = [];
    await page.setViewportSize({width, height: 900});
    await page.route('**/api/explore/launches?*', route => {
      requests.push(route.request().url());
      return route.fulfill({json: navigationPayload(new URL(route.request().url()))});
    });
    await page.goto(origin + '?standalone');
    await expect(page.getByRole('link', {name: /^All 1 /})).toBeVisible();
    await page.getByRole('button', {name: 'Filters', exact: true}).click();
    await page.getByRole('button', {name: 'Base', exact: true}).click();
    await expect(page.getByRole('link', {name: /^Base 1 /})).toBeVisible();
    await page.getByRole('button', {name: 'All chains', exact: true}).click();
    await expect(page.getByRole('link', {name: /^All 1 /})).toBeVisible({timeout: 1000});
    expect(requests).toHaveLength(2);
    await page.getByRole('button', {name: 'Base', exact: true}).click();
    await expect(page.getByRole('link', {name: /^Base 1 /})).toBeVisible({timeout: 1000});
    expect(requests).toHaveLength(2);
  });
}

test('reset removes the chain selection and restores the cached all-chain result', async ({page}) => {
  await page.route('**/api/explore/launches?*', route => route.fulfill({json: navigationPayload(new URL(route.request().url()))}));
  await page.goto(origin + '?standalone');
  await expect(page.getByRole('link', {name: /^All 1 /})).toBeVisible();
  await page.getByRole('button', {name: 'Filters', exact: true}).click();
  await page.getByRole('button', {name: 'Base', exact: true}).click();
  await expect(page.getByRole('link', {name: /^Base 1 /})).toBeVisible();
  await page.getByRole('button', {name: 'Reset', exact: true}).click();
  await expect(page.getByRole('button', {name: 'All chains', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', {name: /^All 1 /})).toBeVisible({timeout: 1000});
});

test('returning to a cached filter preserves a newer matching coin valuation', async ({page}) => {
  await page.route('**/api/explore/launches?*', route => {
    const url = new URL(route.request().url());
    const payload = navigationPayload(url);
    const fresh = url.searchParams.get('chain') === '1';
    return route.fulfill({json: {...payload, presentations: payload.items.map(row => ({
      chainId: row.chainId, tokenAddress: row.tokenAddress, imageUrl: null, description: null, links: [],
      market: { poolId: '0x' + '44'.repeat(32), priceUsd: 1, marketCapUsd: fresh ? 2000 : 1000,
        liquidityUsd: 100, volume24hUsd: 10, change24hPercent: 0,
        observedAt: new Date(Date.now() - (fresh ? 0 : 1000)).toISOString(), sourceUrl: 'https://www.codex.io/' },
    }))}});
  });
  await page.goto(origin + '?standalone');
  await expect(page.getByRole('link', {name: /^All 2 /})).toContainText('$1K');
  await page.getByRole('button', {name: 'Filters', exact: true}).click();
  await page.getByRole('button', {name: 'Ethereum', exact: true}).click();
  await expect(page.getByRole('link', {name: /^Ethereum 2 /})).toContainText('$2K');
  await page.getByRole('button', {name: 'All chains', exact: true}).click();
  await expect(page.getByRole('link', {name: /^All 2 /})).toContainText('$2K', {timeout: 1000});
});

test('returning from a coin preserves the last chain and cached results', async ({page}) => {
  let requests = 0;
  await page.route('**/api/explore/launches?*', route => {
    requests++;
    return route.fulfill({json: navigationPayload(new URL(route.request().url()))});
  });
  await page.goto(origin + '?standalone&navigation');
  await expect(page.getByRole('link', {name: /^All 1 /})).toBeVisible();
  await page.getByRole('button', {name: 'Filters', exact: true}).click();
  await page.getByRole('button', {name: 'Base', exact: true}).click();
  await expect(page.getByRole('link', {name: /^Base 1 /})).toBeVisible();
  await page.getByRole('button', {name: 'Toggle explore', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Coin detail', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Toggle explore', exact: true}).click();
  await expect(page.getByRole('link', {name: /^Base 1 /})).toBeVisible({timeout: 1000});
  await expect(page.getByRole('link', {name: /^All 1 /})).toHaveCount(0);
  expect(requests).toBe(2);
});

test('a click joins the pending page prefetch instead of issuing it twice', async ({page}) => {
  const ready = Promise.withResolvers<void>();
  let pageTwoRequests = 0;
  await page.route('**/api/explore/launches?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('page') === '2') { pageTwoRequests++; await ready.promise; }
    await route.fulfill({json: navigationPayload(url)});
  });
  await page.goto(origin + '?standalone');
  await expect(page.getByRole('link', {name: /^All 1 /})).toBeVisible();
  const next = page.getByRole('button', {name: 'Next page', exact: true});
  try {
    await next.hover();
    await expect.poll(() => pageTwoRequests).toBe(1);
    await next.click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(pageTwoRequests).toBe(1);
  } finally { ready.resolve(); }
  await expect(page.getByRole('link', {name: /^All 11 /})).toBeVisible();
});

test('Base cards retain the chain in their token link', async ({page}) => {
  await page.route('**/api/explore/launches?*', route => route.fulfill({json: navigationPayload(new URL(route.request().url()))}));
  await page.goto(origin + '?standalone');
  await expect(page.getByRole('link', {name: /^All 1 /})).toBeVisible();
  await page.getByRole('button', {name: 'Filters', exact: true}).click();
  await page.getByRole('button', {name: 'Base', exact: true}).click();
  await expect(page.getByRole('link', {name: /^Base 1 /})).toHaveAttribute('href', /\?chain=8453$/);
});

test('back remains responsive while the next page is pending and ignores its late reply', async ({page}) => {
  const ready = Promise.withResolvers<void>();
  await page.route('**/api/explore/launches?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('page') === '2') await ready.promise;
    await route.fulfill({json: navigationPayload(url)}).catch(() => {});
  });
  await page.goto(origin + '?standalone');
  await expect(page.getByRole('link', {name: /^All 1 /})).toBeVisible();
  await page.getByRole('button', {name: 'Next page', exact: true}).click();
  await expect(page.getByRole('list', {name: 'Programmable launches'})).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('link', {name: /^All 1 /})).toHaveCount(0);
  try {
    await page.getByRole('button', {name: 'Previous page', exact: true}).click();
    await expect(page.getByRole('link', {name: /^All 1 /})).toBeVisible({timeout: 1000});
  } finally { ready.resolve(); }
  await expect(page.getByRole('list', {name: 'Programmable launches'})).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('link', {name: /^All 11 /})).toHaveCount(0);
});

test('Ethereum cards retain the unified index mode instead of Robinhood source heuristics', async ({page}) => {
  const address = `0x${'11'.repeat(20)}`, hash = `0x${'22'.repeat(32)}`;
  const modes = ['module', 'custom', 'classic'];
  const items = modes.map((mode, index) => ({
    chainId: 1, mode, category: mode === 'classic' ? 'classic' : 'custom',
    launchId: `ethereum-${index}`, tokenAddress: `0x${String(index + 3).repeat(40)}`,
    hookAddress: address, creator: address, transactionHash: hash, blockNumber: '100',
    launchedAt: new Date().toISOString(), name: `Ethereum fixture ${index}`, symbol: `T${index}`, decimals: 18,
  }));
  await page.route('**/api/explore/launches?*', route => route.fulfill({json: {
    scope: 'all', status: 'ready', updatedAt: new Date().toISOString(), items, presentations: [],
    page: {number: 1, size: 10, totalItems: 3, totalPages: 1, hasMore: false},
  }}));
  await page.goto(origin + '?standalone');
  await expect(page.getByRole('button', {name:/Set up a fomo team tag/})).toHaveCount(0);
  for (const [index, label] of ['Module', 'Custom', 'Classic'].entries()) {
    const card = page.getByRole('link', {name: new RegExp(`Ethereum fixture ${index}`)});
    await expect(card).toContainText(label);
    await expect(card.getByRole('img', {name: 'Ethereum'})).toBeVisible();
  }
});

for (const width of [1440, 390]) {
  for (const state of ['empty', 'unavailable']) {
    test(`owner rewards remain accessible with ${state} launches at ${width}px`, async ({page}) => {
      await page.setViewportSize({width,height:900});
      await page.route('**/api/profile/launches?*', route => state === 'unavailable'
        ? route.fulfill({status:503,json:{error:'temporarily unavailable'}})
        : route.fulfill({json:{scope:'all',status:'ready',account:'0x'+'aa'.repeat(20),items:[],presentations:[],
          page:{number:1,size:10,totalItems:0,totalPages:0,hasMore:false}}}));
      await page.goto(origin+'?profile&chain=1');
      const trigger = page.getByRole('button',{name:'Claim rewards',exact:true});
      await expect(trigger).toBeVisible(); await trigger.click();
      await expect(page.getByLabel('Rewards account')).toHaveText('0x'+'aa'.repeat(20));
      await page.getByRole('button',{name:'Switch fixture wallet',exact:true}).click();
      await trigger.click();
      await expect(page.getByLabel('Rewards account')).toHaveText('0x'+'bb'.repeat(20));
    });
  }

  test(`public profiles do not expose the owner's rewards action at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await page.goto(origin+'?profile&public&chain=1');
    await expect(page.locator('article')).toHaveCount(10);
    await expect(page.getByRole('button',{name:'Claim rewards',exact:true})).toHaveCount(0);
  });

  test(`profile owner can open and dismiss the fomo team-tag dialog at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await page.goto(origin+'?profile&chain=1');
    const trigger = page.getByRole('button', {name:'Set up a fomo team tag for Launch 1',exact:true});
    await trigger.click();
    const dialog = page.getByRole('dialog', {name:'Reach your holders on fomo',exact:true});
    await expect(dialog).toBeVisible();
    const setup = dialog.getByRole('link', {name:'Set up on fomo (opens in a new tab)',exact:true});
    await expect(setup).toHaveAttribute('href','https://fomo.family/team-tag-form');
    await expect(setup).toHaveAttribute('target','_blank');
    await expect(dialog.getByRole('button', {name:'Close fomo team tag',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(setup).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });

  test(`one profile list combines chains and clears the previous wallet at ${width}px`, async ({page}, testInfo) => {
    const errors: string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width,height:900});
    await page.goto(origin+'?profile&chain=1');
    await expect(page.getByRole('heading',{name:'Launches',exact:true})).toHaveCount(1);
    await expect(page.locator('article')).toHaveCount(10);
    await expect(page.getByRole('img',{name:'Ethereum',exact:true}).first()).toBeVisible();
    await expect(page.getByRole('img',{name:'Robinhood Chain',exact:true}).first()).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`unified-profile-${width}.png`),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'Next page',exact:true}).click();
    await expect(page.locator('article')).toHaveCount(2);
    await expect(page.getByRole('link',{name:/Launch 11/})).toBeVisible();
    await page.getByRole('button',{name:'Switch fixture wallet',exact:true}).click();
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.getByRole('link',{name:/Other wallet 1/})).toBeVisible();
    await expect(page.getByRole('link',{name:/Launch 11/})).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
