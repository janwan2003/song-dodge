// End-to-end test in real Chromium, one browser context per person (host on desktop, players on phones):
// create, invite sheet, join from the link, duplicate name, I'm out (place + saboteur), share card, undo, reactions,
// saboteur table, host removes a player, personal link on a new device, link preview text, the final survivors state
// and cards, a stranger after the end, and delete. Screenshots at phone and desktop width go to shots/.
//
// Locally (wrangler dev with TEST_HOOKS=1) it plays the 1–24 December preset with time travel (x-now hook).
// Against production the hook is off, so it plays a custom game that starts today and skips the after-the-end steps.
// Usage: BASE=http://127.0.0.1:8895 node tests/e2e/run.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8895';
const LOCAL = /127\.0\.0\.1|localhost/.test(BASE);
const SHOTS = process.env.SHOTS || 'shots';
fs.mkdirSync(SHOTS, { recursive: true });
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), '.cache/ms-playwright');
  for (const d of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(root, d, 'chrome-linux64/chrome');
    if (fs.existsSync(p)) return p;
  }
}
const TZ = 'Europe/London';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: TZ };
const DESKTOP = { viewport: { width: 1280, height: 860 }, timezoneId: TZ };
const errors = [];
const expected = [/409/, /400/, /404/]; // failed fetches the test provokes on purpose (duplicate name, deleted game)
const browser = await chromium.launch({ executablePath: findChrome() });
async function person(label, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !expected.some((re) => re.test(m.text()))) errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { label, ctx, page };
}
const step = (s) => console.log('·', s);
const shot = (p, name, full = true) => p.screenshot({ path: path.join(SHOTS, name), fullPage: full });
const travel = async (p, iso) => {
  await p.evaluate((ms) => localStorage.setItem('sd:now', String(ms)), Date.parse(iso));
  await p.reload();
  await p.locator('.hero').waitFor();
};
const closeSheet = (p) => p.locator('#sheet [data-close]').last().click();

let gameId;
try {
  const sam = await person('Sam', DESKTOP);
  step('home page (desktop + phone screenshots)');
  await sam.page.goto(BASE + '/');
  await shot(sam.page, 'home-desktop.png');
  const peek = await person('Peek', PHONE);
  await peek.page.goto(BASE + '/');
  await shot(peek.page, 'home-phone.png');

  step('create a game');
  await sam.page.fill('#title', 'The e2e song');
  if (!LOCAL) {
    await sam.page.check('input[value=custom]');
    assert.ok(await sam.page.isVisible('#dates'));
  }
  await sam.page.fill('#name', 'Sam');
  await sam.page.click('#go');
  await sam.page.waitForURL(/\/g\/[A-Za-z0-9]+/);
  gameId = new URL(sam.page.url()).pathname.split('/')[2];
  await sam.page.locator('#sheet').getByText('Your game is ready').waitFor();
  await closeSheet(sam.page);
  const link = `${BASE}/g/${gameId}`;
  if (LOCAL) {
    await sam.page.locator('.hero').getByText('days to go').waitFor();
    assert.equal(await sam.page.locator('#outBtn').count(), 0, 'no I am out before the start');
  }

  step('three players join from the link (phones); duplicate name refused');
  const players = {};
  for (const name of ['Ana', 'Ben', 'Cat', 'Dan']) {
    const p = await person(name, PHONE);
    await p.page.goto(link);
    await p.page.fill('#jname', name);
    await p.page.click('#jgo');
    await p.page.locator('.card h2', { hasText: `, ${name}` }).first().waitFor();
    players[name] = p;
  }
  const dup = await person('Dup', PHONE);
  await dup.page.goto(link);
  await dup.page.fill('#jname', 'ana');
  await dup.page.click('#jgo');
  await dup.page.locator('#jerr').getByText('already playing').waitFor();
  await dup.page.locator('#jerr').getByText('Ask Sam for your personal link').waitFor();
  step('a refresh (tab switch) never wipes a half-typed nickname');
  await dup.page.fill('#jname', 'Half-typed');
  await dup.page.locator('#jname').blur();
  await dup.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await dup.page.waitForTimeout(400);
  assert.equal(await dup.page.inputValue('#jname'), 'Half-typed');
  if (LOCAL) await shot(players.Ana.page, 'board-before-phone.png');

  step('link preview text');
  const html = await (await fetch(link)).text();
  assert.match(html, /<meta property="og:title" content="Avoid The e2e song · Dodgemas">/);
  assert.match(html, LOCAL ? /Starts Tue 1 Dec · 5 players so far/ : /Day 1 of \d+ · 5 of 5 still in/);

  if (LOCAL) {
    step('time travel to 6 December');
    for (const p of [sam, ...Object.values(players)]) await travel(p.page, '2026-12-06T09:00:00Z');
    await sam.page.locator('.hero').getByText('of 5 still in · day 6 of 24').waitFor();
  }

  step('Ben is out at the supermarket, sabotaged by Ana; share card');
  const ben = players.Ben.page;
  await ben.click('#outBtn');
  await ben.locator('#chips button', { hasText: 'Supermarket' }).click();
  assert.equal(await ben.inputValue('#where'), 'Supermarket');
  await ben.fill('#where', 'Supermarket self-checkout');
  const anaId = await ben.locator('#by option', { hasText: 'Ana' }).getAttribute('value');
  await ben.selectOption('#by', anaId);
  await ben.click('#confirmOut');
  await ben.locator('#cardImg').waitFor();
  const natural = await ben.locator('#cardImg').evaluate((i) => (i.complete ? i.naturalWidth : new Promise((r) => (i.onload = () => r(i.naturalWidth)))));
  assert.equal(natural, 1080);
  await shot(ben, 'card-sheet-phone.png', false);
  await closeSheet(ben);
  await ben.locator('.outbox').getByText('got by').waitFor();
  assert.equal(await ben.locator('#outBtn').count(), 0);

  step('Cat taps out by mistake and undoes it, then Dan goes out on the radio');
  const cat = players.Cat.page;
  await cat.click('#outBtn');
  await cat.click('#confirmOut');
  await cat.locator('#cardImg').waitFor();
  await closeSheet(cat);
  await cat.click('#undo');
  await cat.locator('#outBtn').waitFor();
  const dan = players.Dan.page;
  await dan.click('#outBtn');
  await dan.locator('#chips button', { hasText: 'Radio' }).click();
  await dan.click('#confirmOut');
  await dan.locator('#cardImg').waitFor();
  await closeSheet(dan);

  step('board: fallen timeline, saboteur table, reactions');
  const ana = players.Ana.page;
  await ana.reload();
  await ana.locator('#fallen li').nth(1).waitFor();
  assert.equal(await ana.locator('#fallen li').count(), 2);
  await ana.locator('#fallen li', { hasText: 'Ben' }).getByText('Supermarket self-checkout').waitFor();
  await ana.locator('.sab').getByText('1 victim').waitFor();
  await ana.locator('#fallen li', { hasText: 'Ben' }).locator('button', { hasText: '😂' }).click();
  await ana.locator('#fallen li', { hasText: 'Ben' }).locator('button.on', { hasText: '😂 1' }).waitFor();
  await ana.locator('.hero').getByText('3').first().waitFor();
  await shot(ana, 'board-live-phone.png');
  await sam.page.reload();
  await sam.page.locator('#fallen li').nth(1).waitFor();
  await shot(sam.page, 'board-live-desktop.png');

  step('still-in card; Escape closes the sheet');
  await ana.click('#brag');
  await ana.locator('#cardImg').waitFor();
  await shot(ana, 'card-still-in-phone.png', false);
  await ana.keyboard.press('Escape');
  assert.equal(await ana.locator('#sheet').count(), 0, 'Escape closes the sheet');

  step('share cards stay inside their layout with long and many names');
  const stress = await ana.evaluate(async () => {
    const { drawCard } = await import('/card.js');
    const names = ['Wolfgang-Amadeus Ritter', 'Ana', 'Benedikt', 'Cat', 'Siobhán', 'Priya', 'Tomasz', 'Aoife', 'Lars', 'Mia', 'Jonas', 'Ellie', 'Oluwaseun', 'Zoë'];
    const hall = drawCard('hall', { title: 'That one Christmas song with the sleigh bells and the whistle', day: 24, days: 24, alive: names.length, total: 20, names });
    const out = drawCard('out', { title: 'Supercalifragilisticexpialidocious-the-very-long-song-title', day: 12, days: 24, where: 'Tesco self-checkout at 8:15 am, then again in the car park, then a third time at the bus stop on the way home', by: 'WWWWWWWWWWWWWWWWWWWWWWWW', alive: 3, total: 9, names: [] });
    document.body.innerHTML = `<div style="display:flex;gap:6px;background:#333"><img src="${hall.toDataURL()}" style="width:50%"><img src="${out.toDataURL()}" style="width:50%"></div>`;
    return [hall.width, out.width];
  });
  assert.deepEqual(stress, [1080, 1080]);
  await shot(ana, 'card-stress-phone.png', false);
  await ana.reload();
  await ana.locator('.hero').waitFor();

  step('personal link moves Ana to a new device');
  await ana.click('#devLink');
  const devUrl = await ana.inputValue('#devIn');
  await closeSheet(ana);
  const ana2 = await person('Ana2', DESKTOP);
  await ana2.page.goto(devUrl);
  await ana2.page.locator('.card h2', { hasText: ', Ana' }).waitFor();
  assert.ok(!ana2.page.url().includes('#k='), 'token removed from the address bar');

  step('host makes a new personal link for Cat (lost access); it signs Cat in on a new browser, the old one is signed out');
  await sam.page.click('#kick');
  await sam.page.locator('.plist li', { hasText: 'Cat' }).locator('[data-relink]').click();
  const relink = await sam.page.inputValue('#relinkIn');
  assert.match(relink, /#k=/);
  await shot(sam.page, 'players-sheet-desktop.png', false);
  await closeSheet(sam.page);
  const cat2 = await person('Cat2', PHONE);
  await cat2.page.goto(relink);
  await cat2.page.locator('.card h2', { hasText: ', Cat' }).waitFor();
  await cat.reload();
  await cat.locator('#joinBox').waitFor();

  step('host removes Dan; host edits the rules');
  await sam.page.click('#kick');
  await sam.page.locator('.plist li', { hasText: 'Dan' }).locator('[data-kick]').click();
  await sam.page.waitForFunction(() => document.querySelectorAll('#fallen li').length === 1);
  await sam.page.click('#edit');
  await sam.page.fill('#eRules', 'Original only. Sabotage encouraged.');
  await sam.page.click('#editF button');
  await sam.page.locator('.hero .rules', { hasText: 'Sabotage encouraged' }).waitFor();

  if (LOCAL) {
    step('after Christmas Eve: survivors crowned');
    for (const p of [sam, players.Ana, players.Ben]) await travel(p.page, '2026-12-25T08:00:00Z');
    await sam.page.locator('.winbox h2', { hasText: 'You survived, Sam' }).waitFor();
    const hall = await sam.page.locator('.winbox .chip').allTextContents();
    assert.deepEqual(hall.sort(), ['Ana', 'Cat', 'Sam']);
    await shot(sam.page, 'board-final-desktop.png');
    await players.Ben.page.locator('.winbox h2', { hasText: 'The survivors' }).waitFor();
    await players.Ben.page.locator('.outbox').waitFor();
    await players.Ana.page.click('#cardWon');
    await players.Ana.page.locator('#cardImg').waitFor();
    await shot(players.Ana.page, 'card-survivor-phone.png', false);
    await closeSheet(players.Ana.page);
    await players.Ana.page.click('#cardHall');
    await players.Ana.page.locator('#cardImg').waitFor();
    await shot(players.Ana.page, 'card-hall-phone.png', false);
    await closeSheet(players.Ana.page);
    await shot(players.Ana.page, 'board-final-phone.png');
    step('a stranger after the end sees "start your own"');
    const late = await person('Late', PHONE);
    await late.page.evaluate(() => 0);
    await late.page.goto(BASE + '/');
    await late.page.evaluate(() => localStorage.setItem('sd:now', String(Date.parse('2026-12-25T08:00:00Z'))));
    await late.page.goto(link);
    await late.page.getByText('This game is over').waitFor();
    assert.equal(await late.page.locator('#join').count(), 0);
  }

  step('home lists your games; host deletes the game');
  await sam.page.goto(BASE + '/');
  await sam.page.locator('#mineList a', { hasText: 'The e2e song' }).waitFor();
  await sam.page.goto(link);
  await sam.page.click('#del');
  await sam.page.waitForURL(BASE + '/');
  const gone = await fetch(`${BASE}/api/games/${gameId}`);
  assert.equal(gone.status, 404);
  gameId = null;

  assert.deepEqual(errors, [], 'no console errors');
  console.log(`\nPASS (${LOCAL ? 'local, with time travel' : 'production, no time travel'}) · screenshots in ${SHOTS}/`);
} catch (e) {
  console.error('\nFAIL', e);
  if (errors.length) console.error('console errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
