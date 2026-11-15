// Text from the box shows as text, never as markup. Channel labels and the hostname are free text
// anyone on the network can set (the web UI has no login). The status page's change log and the
// navbar on every page put them into the page as HTML: a label like <b>Spot</b> came out bold, and
// one with an <img onerror> ran its script in every browser that opened the box. /info.json wrote
// the hostname (and the WiFi name) without JSON escaping, so a quote in it broke /info.json, and
// with it every page. (CodeQL js/xss on index.html; the navbar and /info.json were the same bug.)
//
// Read-only: the browser alone gets labels and a hostname with markup in them (page.route), real
// Art-Net AND sACN go to the box, and the change log and the navbar must show them as text.
// Opt-in (LUXDMX_WRITE=1): the same label and hostname stored on the box for real; /info.json stays
// JSON, the backup's file name keeps only safe characters. Labels and config are put back after.
// Not here: the setup-done page's link (made from the hostname) needs the box to switch to WiFi.
import { test, expect } from '@playwright/test';
import {
  deviceHost, UdpSender, streamFor, artDmxPacket, e131Packet, prepInput, sleep, ART_PORT, SACN_PORT,
} from './lib/net.mjs';
import { info, universes } from './lib/device.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
const LABEL = `<img src=x onerror="window.__luxXss=1">Spot "1" & <b>B</b>`;
const HOST = `<img src=x onerror=__h=1>"q`;            // (fits the hostname field's 32)
const JSON_HDR = { 'Content-Type': 'application/json' };

// A change on channel 7 over one protocol, while the status page is open; resolves once the change
// log shows `want`.
async function changeCh7(page, request, proto, val, want) {
  const host = await deviceHost();
  const { art, sacn } = await universes(request);
  await prepInput(host);
  const sender = new UdpSender(host);
  const [port, make] = proto === 'artnet'
    ? [ART_PORT, (i, b) => artDmxPacket(art, b, i)]
    : [SACN_PORT, (i, b) => e131Packet(sacn, b, i)];
  try {
    const base = Buffer.alloc(512);
    await streamFor(sender, port, (i) => make(i, base), { ms: 500 });
    await sleep(300);                                   // (past the log's 200 ms throttle)
    const changed = Buffer.alloc(512); changed[6] = val;
    const streaming = streamFor(sender, port, (i) => make(i, changed), { ms: 3000 });
    await expect(page.locator('#log-body')).toContainText(want, { timeout: 6000 });
    await streaming;
  } finally { sender.close(); }
}
async function noMarkup(page, sel) {
  await expect(page.locator(`${sel} img, ${sel} b`)).toHaveCount(0);
  expect(await page.evaluate(() => [window.__luxXss, window.__h])).toEqual([undefined, undefined]);
}
const protocols = async (request) => {
  const d = await info(request);
  return [...(d.protocol !== 1 ? ['artnet'] : []), ...(d.protocol !== 0 ? ['sacn'] : [])];
};

for (const proto of ['artnet', 'sacn']) {
  test(`a label with markup shows as text in the change log (${proto})`, async ({ page, request }) => {
    test.skip(!(await protocols(request)).includes(proto), `the box doesn't take ${proto}`);
    // (this browser only: the box's own labels stay as they are)
    await page.route('**/labels.json', (r) => r.fulfill({ json: { 0: { 7: LABEL } } }));
    await page.goto('/');
    await expect(page.locator('#ws-badge')).toHaveText(/Live/);
    await expect(page.locator('#l7')).toHaveText(LABEL);
    const val = proto === 'artnet' ? 211 : 212;
    await changeCh7(page, request, proto, val, LABEL + '=' + val);
    await noMarkup(page, '#log-body');
  });
}

test('a hostname with markup shows as text in the navbar', async ({ page }) => {
  // (this browser only: the box keeps its name)
  await page.route('**/info.json', async (r) => {
    const res = await r.fetch();
    r.fulfill({ response: res, json: { ...(await res.json()), hostname: HOST } });
  });
  for (const path of ['/', '/config', '/rdm']) {
    await page.goto(path);
    await expect(page.locator('#nav-sub')).toContainText(HOST + '.local');
    await noMarkup(page, '#nav-sub');
  }
});

test.describe('stored on the box', () => {
  test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');

  test('a label with markup: kept as typed, shown as text, over Art-Net and sACN', async ({ page, request }) => {
    const original = await (await request.get('/labels.json')).text();
    try {
      const r = await request.post('/labels', { data: JSON.stringify({ 0: { 7: LABEL } }), headers: JSON_HDR });
      expect(r.ok()).toBeTruthy();
      expect((await (await request.get('/labels.json')).json())['0']['7']).toBe(LABEL);
      await page.goto('/');
      await expect(page.locator('#ws-badge')).toHaveText(/Live/);
      await expect(page.locator('#l7')).toHaveText(LABEL);
      let val = 221;
      for (const proto of await protocols(request)) {
        await changeCh7(page, request, proto, val, LABEL + '=' + val);
        await noMarkup(page, '#log-body');
        val++;
      }
    } finally {
      await request.post('/labels', { data: original, headers: JSON_HDR });
    }
  });

  test('a hostname with a quote and markup: /info.json stays JSON, the navbar shows it as text', async ({ page, request }) => {
    test.setTimeout(240_000);
    const exportCfg = async () => (await request.get('/config.json?secrets=1')).json();
    const importCfg = async (body) => (await request.post('/config/import', { data: JSON.stringify(body), headers: JSON_HDR })).status();
    // It answers first and restarts a moment later: wait for it to go away, then to come back.
    const waitRestart = async () => {
      let gone = false;
      for (let i = 0; i < 40 && !gone; i++) {
        try { await request.get('/info.json', { timeout: 1000 }); await sleep(250); } catch { gone = true; }
      }
      expect(gone, 'the box never went away, so it never restarted').toBeTruthy();
      let back = null;
      for (let i = 0; i < 60 && !back; i++) { try { back = await info(request); } catch { await sleep(1000); } }
      expect(back, 'the box did not come back within a minute').toBeTruthy();
    };
    const before = await exportCfg();
    try {
      expect(await importCfg({ ...before, config: { ...before.config, hostname: HOST } })).toBe(200);
      await waitRestart();
      const raw = await (await request.get('/info.json')).text();
      expect(() => JSON.parse(raw), '/info.json is JSON with a quote in the name').not.toThrow();
      expect(JSON.parse(raw).hostname).toBe(HOST);
      for (const path of ['/', '/config']) {
        await page.goto(path);
        await expect(page.locator('#nav-sub')).toContainText(HOST + '.local');
        await noMarkup(page, '#nav-sub');
      }
      const dl = await request.get('/config.json?download=1');
      expect(dl.headers()['content-disposition']).toBe('attachment; filename="imgsrcxonerrorh1q-config.json"');
    } finally {
      expect(await importCfg(before)).toBe(200);
      await waitRestart();
      expect((await exportCfg()).config).toEqual(before.config);
    }
  });
});
