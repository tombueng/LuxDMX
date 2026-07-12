// The dedicated RDM tab (/rdm) + its richer /rdm.json and controls: manufacturer/model
// labels, per-fixture device label (get/set), DMX personality (get/set), and live sensor
// polling with min/max. Read-only paths run by default; the paths that drive the RDM wire
// (discovery, SET label/personality, live polling) gate behind LUXDMX_WRITE=1.
//
// These need a fixture on the bench that answers the extra PIDs. The RP2350 sim
// (dmx-analyzer) does: 8 fixture profiles with settable labels, real personalities and
// varied sensors. On-wire timing/DMX-not-disturbed is measured on the analyzer rig.
import { test, expect } from '@playwright/test';
import { deviceHost, wsSend } from './lib/net.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';

async function json(res) {
  expect(res.headers()['content-type']).toContain('application/json');
  return res.json();
}
async function rdm(request) { return json(await request.get('/rdm.json')); }

test.describe('RDM tab — page + shape (always)', () => {
  test('GET /rdm serves the RDM tab page', async ({ request }) => {
    const r = await request.get('/rdm');
    expect(r.ok()).toBeTruthy();
    const html = await r.text();
    expect(html).toContain('Fixtures (RDM)');
    expect(html).toContain('Live sensors');      // the live-poll switch
    expect(html).toContain('class="fxt"');       // fixtures table (info visible without expanding)
    expect(html).toContain('chart-svg');         // grouped sensor history charts (axes + scale)
    expect(html).toContain('sensorGroups');      // sensors aggregated by RDM type
    expect(html).toContain('progress-bar');      // live discovery progress bar
    expect(html).toContain('@view-transition');  // smooth cross-page navigation
    expect(html).toContain('rdm_sensorsel');     // per-sensor + per-fixture poll switches
    expect(html).not.toContain('max-width:1000px'); // full display width, like the Status card
    expect(html).toContain('uni-badge');         // per-fixture universe column
    expect(html).toContain('renderDiscCtl');     // per-universe Discover buttons
    // same live nav strip as the Status page (fps/rssi/heap/uptime/jitter)
    for (const id of ['nav-stats', 'id="fps"', 'id="rssi"', 'id="heap"', 'id="uptime"', 'id="jitter"'])
      expect(html, id).toContain(id);
  });

  test('/rdm.json exposes the sensor-poll flag + rich per-fixture fields', async ({ request }) => {
    const j = await rdm(request);
    expect(typeof j.sensorPoll).toBe('boolean');
    // live discovery-progress fields (drive the "scanning the line" bar)
    for (const k of ['discStage', 'discFound', 'discCur', 'discSub']) expect(typeof j[k], k).toBe('number');
    // multi-line RDM: the RDM-capable universes + a per-fixture universe
    expect(Array.isArray(j.rdmLines)).toBe(true);
    for (const l of j.rdmLines) { expect(typeof l.line).toBe('number'); expect(typeof l.uni).toBe('number'); }
    for (const f of j.devices) expect(typeof f.uni, 'uni').toBe('number');
    for (const f of j.devices) {
      for (const k of ['mfg', 'modelName', 'label']) expect(typeof f[k], k).toBe('string');
      for (const k of ['cat', 'swVer']) expect(typeof f[k], k).toBe('number');
      for (const s of (f.sensors || []))
        for (const k of ['value', 'lo', 'hi', 'rec', 'type']) expect(typeof s[k], k).toBe('number');
    }
  });
});

test.describe('RDM tab — controls + live sensors (LUXDMX_WRITE=1)', () => {
  test.skip(!WRITE, 'wire-mutating: set LUXDMX_WRITE=1 to run against the bench bus');
  let host;
  test.beforeAll(async () => { host = await deviceHost(); });

  async function discover(request) {
    await request.get('/rdm/discover');
    await expect.poll(async () => (await rdm(request)).discovering, { timeout: 20000 }).toBe(true);
    // a full 64-fixture sweep takes a while, and the rapid polling here loads the device too
    await expect.poll(async () => (await rdm(request)).discovering, { timeout: 45000 }).toBe(false);
    return rdm(request);
  }

  test('discovery reads manufacturer, model description and varied sensors', async ({ request }) => {
    const j = await discover(request);
    test.skip(!j.devices.length, 'no fixtures on the bus');
    const f = j.devices[0];
    expect(f.mfg.length).toBeGreaterThan(0);
    expect(f.modelName.length).toBeGreaterThan(0);
    // at least one fixture in the set reports more than one sensor
    expect(Math.max(...j.devices.map((d) => (d.sensors || []).length))).toBeGreaterThan(1);
  });

  test('discovery reports live progress (stage + found count advance)', async ({ request }) => {
    // Wait for any in-flight sweep to settle, then scan a fresh one and watch the progress fields.
    // (A multi-universe sweep visits an empty line last, so watching a leftover scan can see 0 found.)
    await expect.poll(async () => (await rdm(request)).discovering, { timeout: 45000 }).toBe(false);
    await request.get('/rdm/discover');
    let maxStage = 0, sawFound = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      const j = await rdm(request);
      if (j.discStage > maxStage) maxStage = j.discStage;
      if (j.discFound > sawFound) sawFound = j.discFound;
      if (!j.discovering && maxStage > 0 && sawFound > 0) break;
    }
    expect(maxStage).toBeGreaterThanOrEqual(1);   // reached at least the search phase
    expect(sawFound).toBeGreaterThan(0);          // found at least one fixture during the scan
  });

  test('per-universe discovery leaves the other universes untouched', async ({ request }) => {
    await expect.poll(async () => (await rdm(request)).discovering, { timeout: 45000 }).toBe(false);
    const j = await rdm(request);
    test.skip((j.rdmLines || []).length < 2, 'needs two RDM universes');
    const uni0 = j.rdmLines[0].uni;
    const before = j.devices.filter((d) => d.uni === uni0).length;
    test.skip(!before, 'no fixtures on the first universe');
    // rescan a different line; the first universe's fixtures must survive the merge
    const other = j.rdmLines[j.rdmLines.length - 1].line;
    await request.get('/rdm/discover?line=' + other);
    await expect.poll(async () => (await rdm(request)).discovering, { timeout: 25000 }).toBe(false);
    const after = (await rdm(request)).devices.filter((d) => d.uni === uni0).length;
    expect(after).toBe(before);
  });

  test('SET device label round-trips', async ({ request }) => {
    const j = await rdm(request);
    test.skip(!j.devices.length, 'no fixtures');
    const uid = j.devices[0].uid;
    const before = j.devices[0].label;
    const target = before === 'e2e-test' ? 'e2e-test2' : 'e2e-test';
    await wsSend(host, { type: 'rdm_setlabel', uid, label: target });
    await expect.poll(async () => (await rdm(request)).devices.find((d) => d.uid === uid)?.label,
      { timeout: 6000 }).toBe(target);
    await wsSend(host, { type: 'rdm_setlabel', uid, label: before });   // restore
  });

  test('SET DMX personality round-trips', async ({ request }) => {
    const j = await rdm(request);
    const dev = j.devices.find((d) => d.persCount > 1);
    test.skip(!dev, 'no multi-personality fixture');
    const before = dev.pers;
    const target = before === 1 ? 2 : 1;
    await wsSend(host, { type: 'rdm_setpers', uid: dev.uid, pers: target });
    await expect.poll(async () => (await rdm(request)).devices.find((d) => d.uid === dev.uid)?.pers,
      { timeout: 6000 }).toBe(target);
    await wsSend(host, { type: 'rdm_setpers', uid: dev.uid, pers: before });   // restore
  });

  test('per-fixture switch toggles all of a fixture\'s sensors', async ({ request }) => {
    const j = await rdm(request);
    const dev = j.devices.find((d) => (d.sensors || []).length > 1);
    test.skip(!dev, 'no multi-sensor fixture');
    const find = async () => (await rdm(request)).devices.find((d) => d.uid === dev.uid)?.sensors || [];
    await wsSend(host, { type: 'rdm_sensorsel', uid: dev.uid, sensor: -1, on: true });   // whole fixture on
    await expect.poll(async () => (await find()).every((s) => s.poll), { timeout: 6000 }).toBe(true);
    await wsSend(host, { type: 'rdm_sensorsel', uid: dev.uid, sensor: -1, on: false });  // whole fixture off
    await expect.poll(async () => (await find()).some((s) => s.poll), { timeout: 6000 }).toBe(false);
  });

  test('live sensor polling toggles and updates values', async ({ request }) => {
    const j = await rdm(request);
    // Enable a handful of fixtures: enough that at least one sensor is sure to drift in the window,
    // but few enough that they still poll near the full ~1 Hz (not starved by the whole bus).
    const devs = j.devices.filter((d) => (d.sensors || []).length).slice(0, 8);
    test.skip(!devs.length, 'no fixture with sensors');
    const uids = new Set(devs.map((d) => d.uid));
    // Clean slate first (other tests may have left sensors enabled) so only these fixtures share the
    // poll budget and therefore refresh at the full ~1 Hz.
    await wsSend(host, { type: 'rdm_sensorpoll', on: false });
    await expect.poll(async () => (await rdm(request)).sensorPoll, { timeout: 4000 }).toBe(false);
    for (const d of devs) await wsSend(host, { type: 'rdm_sensorsel', uid: d.uid, sensor: -1, on: true });
    await expect.poll(async () => (await rdm(request)).sensorPoll, { timeout: 4000 }).toBe(true);
    const fp = async () => (await rdm(request)).devices.filter((d) => uids.has(d.uid))
      .flatMap((d) => (d.sensors || []).map((s) => s.value)).join(',');
    const first = await fp();
    try {
      await expect.poll(async () => (await fp()) !== first, { timeout: 25000, intervals: [1000] }).toBe(true);
    } finally {
      await wsSend(host, { type: 'rdm_sensorpoll', on: false });   // all sensors off
    }
  });
});
