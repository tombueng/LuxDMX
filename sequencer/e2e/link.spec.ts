// LuxDMX Link: the app talks to the helper on this computer (no popup, no click), and the helper
// sends Art-Net (and sACN when picked) to any node. The real helper binary runs here with its
// output pointed at local ports, where this test reads the packets (with -to it doesn't poll the
// networks either: nothing of this test goes on the LAN). When it isn't running, the app offers
// the download for this computer from public/link/ (node scripts/build-link.mjs).
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { fresh, goLive, patch, selectAll, full, test, expect } from './helpers';

// the file people download (what the app offers), else a plain `go build` in link/
const BIN = ['public/link/luxdmx-link-linux-amd64', 'link/dist/luxdmx-link-linux-amd64'].find((f) => fs.existsSync(f)) ?? '';
const MANIFEST = 'public/link/manifest.json';
let link: ChildProcess | undefined;
const art: Buffer[] = [], sacn: Buffer[] = [];
let artSock: dgram.Socket, sacnSock: dgram.Socket;

const answers = async () => { try { return (await fetch('http://127.0.0.1:47920/info.json')).ok; } catch { return false; } };
async function startLink() {
  // another Link here (an installed one) would get the frames and send them to the network: never
  if (await answers()) throw new Error('a LuxDMX Link already runs on this computer (port 47920): stop it for this test');
  link = spawn(BIN, ['-run', '-artnet-port', '16454', '-to', '127.0.0.1:16455', '-sacn-to', '127.0.0.1:15568'], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await answers()); i++) await new Promise((r) => setTimeout(r, 100));
}
async function stopLink() {
  link?.kill(); link = undefined;
  for (let i = 0; i < 50 && (await answers()); i++) await new Promise((r) => setTimeout(r, 100));
}

test.skip(!BIN, 'build LuxDMX Link first: node scripts/build-link.mjs --only linux-amd64');
// (a screen wide enough for the connected Link pill on the top bar: at 1400 px the bar is full and
// the boxes fold into one button, which has its own test at the end)
test.use({ viewport: { width: 1700, height: 900 } });
test.beforeAll(async () => {
  artSock = dgram.createSocket('udp4'); sacnSock = dgram.createSocket('udp4');
  artSock.on('message', (m) => { art.push(m); if (art.length > 400) art.shift(); });
  sacnSock.on('message', (m) => { sacn.push(m); if (sacn.length > 400) sacn.shift(); });
  await new Promise<void>((r) => artSock.bind(16455, '127.0.0.1', r));
  await new Promise<void>((r) => sacnSock.bind(15568, '127.0.0.1', r));
  await startLink();
});
test.afterAll(() => { link?.kill(); artSock?.close(); sacnSock?.close(); });

const AXE = fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
async function audit(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const res = await (window as any).axe.run(document, { resultTypes: ['violations'] });
    return res.violations.map((v: any) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n: any) => n.target.join(' ')).join(' | ')}`);
  });
}
async function addLink(page: Page) {
  await fresh(page);
  const boxes = page.locator('.top').getByRole('button', { name: /LuxDMX boxes/ });
  if (await boxes.isVisible()) await boxes.click(); else await page.getByRole('button', { name: 'Add a LuxDMX' }).click();
  await page.getByRole('button', { name: 'Art-Net / sACN from this computer' }).click();
}

const lastArt = (uni: number) => [...art].reverse().find((p) => p.toString('latin1', 0, 8) === 'Art-Net\0' && p.readUInt16LE(8) === 0x5000 && (p[14] | (p[15] << 8)) === uni);
const lastSacn = (u: number) => [...sacn].reverse().find((p) => p.toString('latin1', 4, 13) === 'ASC-E1.17' && p.readUInt16BE(113) === u);

test('Art-Net and sACN from this computer: the app finds Link by itself and the look goes out', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: 'Add a LuxDMX' }).click();
  await page.getByRole('button', { name: 'Art-Net / sACN from this computer' }).click();
  await expect(page.locator('.dev[data-box="link"]')).toContainText('connected');
  // live straight away: no Get Link button, no download panel
  await expect(page.locator('.dev[data-box="link"]').getByRole('button', { name: 'Get Link' })).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(page.getByRole('dialog', { name: 'Get LuxDMX Link' })).toHaveCount(0);
  await goLive(page);                                                    // (to the stage: a new browser starts blind)
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await selectAll(page); await full(page);
  await expect.poll(() => lastArt(0)?.subarray(18, 20).toJSON().data, { timeout: 5000 }).toEqual([255, 255]);
  // sACN instead: universe 1 (Art-Net 0), the channels after the start code
  await page.locator('.dev[data-box="link"]').getByLabel('Send as').selectOption('sacn');
  sacn.length = 0;
  await expect.poll(() => lastSacn(1)?.subarray(125, 128).toJSON().data, { timeout: 5000 }).toEqual([0, 255, 255]);
  // and it's kept with the show
  expect(await page.evaluate(() => (window as any).__luxdmx.show.outputs.devices.find((d: any) => d.host === 'link').proto)).toBe('sacn');
  // Link's own status page sees this page and what it sends
  const status = await (await fetch('http://127.0.0.1:47920/')).text();
  expect(status).toContain('LuxDMX Link is running');
  expect(status).toContain('Pages connected: 1');
  expect(status).toContain(new URL(page.url()).origin);
  // (frames per second as Link counted them in the last second: a still look is its heartbeat)
  await expect.poll(async () => (await fetch('http://127.0.0.1:47920/')).text()).toMatch(/Sending: universe 0: \d+\/s/);
});

test('Link stopped: the pill says it isn\'t running; started again: connected again by itself', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: 'Add a LuxDMX' }).click();
  await page.getByRole('button', { name: 'Art-Net / sACN from this computer' }).click();
  await expect(page.locator('.dev[data-box="link"]')).toContainText('connected');
  await stopLink();
  await expect(page.locator('.dev[data-box="link"]')).toContainText(/reconnecting|not running/);
  await startLink();
  await expect(page.locator('.dev[data-box="link"]')).toContainText('connected', { timeout: 10000 });
});

test('not running: the app offers the download for this computer (Linux), and goes live once it runs', async ({ page }) => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await stopLink();
  await fresh(page);
  await page.getByRole('button', { name: 'Add a LuxDMX' }).click();
  await page.getByRole('button', { name: 'Art-Net / sACN from this computer' }).click();
  const pill = page.locator('.dev[data-box="link"]');
  await expect(pill).toContainText('not running');
  // it opens by itself a moment after adding, with the focus on the download
  const panel = page.getByRole('dialog', { name: 'Get LuxDMX Link' });
  await expect(panel).toBeVisible();
  const mine = panel.getByRole('link', { name: /^Download for Linux/ });
  await expect(mine).toHaveCount(1);
  await expect(mine).toBeFocused();
  // the right file (this browser runs on x86-64 Linux), and it's really there, as the manifest says
  const href = await mine.getAttribute('href');
  expect(href).toBe('./link/luxdmx-link-linux-amd64');
  const file = fs.readFileSync('public/' + href!.slice(2));
  const entry = manifest.files.find((f: any) => f.file === 'luxdmx-link-linux-amd64');
  expect(entry.size).toBe(file.length);
  expect(entry.sha256).toBe(createHash('sha256').update(file).digest('hex'));
  await expect(mine).toContainText(`${(entry.size / 1e6).toFixed(1)} MB`);
  await expect(panel).toContainText('Make it executable');
  await expect(panel).toContainText(`Version ${manifest.version}`);
  // the browser downloads it under its own name (the app serves it, no other site involved)
  const [dl] = await Promise.all([page.waitForEvent('download'), mine.click()]);
  expect(dl.suggestedFilename()).toBe('luxdmx-link-linux-amd64');
  expect(fs.statSync(await dl.path()).size).toBe(file.length);
  // the other systems, each pointing at a file that's there
  await panel.getByText('Other systems').click();
  const others = panel.locator('details a');
  await expect(others).toHaveCount(manifest.files.length - 1);
  for (const h of await others.evaluateAll((as) => as.map((a) => a.getAttribute('href')!))) expect(fs.existsSync('public/' + h.slice(2)), h).toBe(true);
  await expect(others.filter({ hasText: 'Apple chip' })).toHaveAttribute('href', './link/luxdmx-link-macos-arm64.zip');
  expect(await audit(page), 'axe on the open panel').toEqual([]);
  // Escape closes it, Get Link opens it again
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await pill.getByRole('button', { name: 'Get Link' }).click();
  await expect(panel).toBeVisible();
  // Link starts (as the installed copy would at login): the panel goes, the pill is live, no click
  await startLink();
  await expect(pill).toContainText('connected', { timeout: 10000 });
  await expect(panel).toHaveCount(0);
  await expect(pill.getByRole('button', { name: 'Get Link' })).toHaveCount(0);
});

// Chrome asks before a page from the internet may reach this computer (Local Network Access). Said
// no, the WebSocket to Link fails as if it weren't running: here the browser's answer is 'denied'
// and the connection to Link fails the same way, until it's allowed in the site settings.
test('the browser blocks this page from the local network: the pill says so, the panel says how to allow it, allowed it connects', async ({ page }) => {
  await page.addInitScript(() => {
    let blocked = true;
    const st = { state: 'denied', onchange: null as null | (() => void) };
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = ((d: { name: string }) => (d.name === 'loopback-network' || d.name === 'local-network-access' ? Promise.resolve(st) : q(d as PermissionDescriptor))) as typeof navigator.permissions.query;
    const WS = window.WebSocket;
    (window as any).WebSocket = class extends WS { constructor(u: string | URL, p?: string | string[]) { super(blocked && String(u).includes('127.0.0.1:47920') ? 'ws://127.0.0.1:9/' : u, p); } };
    (window as any).__allowLocalNetwork = () => { blocked = false; st.state = 'granted'; st.onchange?.(); };
  });
  await addLink(page);
  const pill = page.locator('.dev[data-box="link"]');
  await expect(pill).toContainText('blocked by the browser');
  await expect(pill).toHaveAttribute('title', /blocks this page from reaching programs on this computer/);
  const panel = page.getByRole('dialog', { name: 'Get LuxDMX Link' });
  await expect(panel.getByTestId('link-blocked')).toContainText('Allow access to the local network');
  expect(await audit(page)).toEqual([]);
  // allowed in the site settings: found at once, no reload, and the panel goes
  await page.evaluate(() => (window as any).__allowLocalNetwork());
  await expect(pill).toContainText('connected', { timeout: 5000 });
  await expect(panel).toHaveCount(0);
});

test('a Mac whose browser doesn\'t say which chip: both Mac files to pick from, with how to tell', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
    Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15' });
  });
  await stopLink();
  await fresh(page);
  await page.getByRole('button', { name: 'Add a LuxDMX' }).click();
  await page.getByRole('button', { name: 'Art-Net / sACN from this computer' }).click();
  const panel = page.getByRole('dialog', { name: 'Get LuxDMX Link' });
  const mine = panel.getByRole('link', { name: /^Download for macOS/ });
  await expect(mine).toHaveCount(2);
  await expect(mine.first()).toHaveAttribute('href', './link/luxdmx-link-macos-arm64.zip');
  await expect(mine.first()).toContainText('Apple chip');
  await expect(mine.last()).toHaveAttribute('href', './link/luxdmx-link-macos-amd64.zip');
  await expect(panel).toContainText('right-click LuxDMX Link, Open');
  await expect(panel).toContainText('About This Mac');
  await startLink();
  await expect(page.locator('.dev[data-box="link"]')).toContainText('connected', { timeout: 10000 });
});

// (at 820 px the top bar wraps and puts the boxes button near the left: the list used to hang off the edge)
test('in the folded boxes list (a tablet or a narrow window) the panel sits in the list and fits', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 700 });
  await stopLink();
  await addLink(page);
  const panel = page.getByRole('dialog', { name: 'Get LuxDMX Link' });
  await expect(panel).toBeVisible();
  await expect(page.locator('.pop.list')).toContainText('Get LuxDMX Link');
  const r = await panel.getByRole('link', { name: /^Download for Linux/ }).boundingBox();
  expect(r && r.x >= 0 && r.x + r.width <= 820 && r.height >= 44, 'the download fits the window and is finger sized').toBe(true);
  await startLink();
  await expect(panel).toHaveCount(0);
});
