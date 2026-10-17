// Config backup and restore (issue #108). GET /config.json hands out every setting plus the
// channel labels as one file, POST /config/import takes it back, saves and reboots.
//
// Read-only: the file's shape, that it says the same as /info.json, that passwords are left out
// unless asked for, and that the /config page's download link gives the same file.
//
// Opt-in (LUXDMX_WRITE=1), and every one of these puts the original config back:
// - files that must be refused (not JSON, not a backup, an out-of-range value, an unknown key, a
//   different chip/board) are refused with nothing changed and no restart;
// - a partial file changes only its own keys. The sharp edge: a boolean that isn't in the file
//   must NOT be switched off, the way an unticked box on the /config form would be. A file that
//   dropped useeth would strand a wired box in its setup AP;
// - restoring the full original file brings everything back, labels included;
// - after each restart, Art-Net AND sACN input still reaches the output.
import { test, expect } from '@playwright/test';
import {
  deviceHost, UdpSender, streamFor, artDmxPacket, e131Packet, prepInput, sleep,
  ART_PORT, SACN_PORT,
} from './lib/net.mjs';
import { info, dmx, pollFor, universes } from './lib/device.mjs';
import { openConfig } from './lib/ui.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
function skipUnlessWrite() { test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run'); }

async function exportCfg(request, secrets = false) {
  const r = await request.get('/config.json' + (secrets ? '?secrets=1' : ''));
  expect(r.ok(), `GET /config.json -> ${r.status()}`).toBeTruthy();
  return r.json();
}
async function importCfg(request, body, force = false) {
  const r = await request.post('/config/import' + (force ? '?force=1' : ''), {
    data: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status(), j };
}
async function uptimeSec(request) {
  const m = /(\d+)d (\d+):(\d+):(\d+)/.exec((await dmx(request)).up);
  return m ? +m[1] * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4] : 0;
}
// It answers first and restarts a moment later: wait for it to go away, then to come back.
async function waitRestart(request) {
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    try { await request.get('/info.json', { timeout: 1000 }); await sleep(250); } catch { gone = true; }
  }
  expect(gone, 'device never went away, so it never restarted').toBeTruthy();
  let back = null;
  for (let i = 0; i < 60 && !back; i++) { try { back = await info(request); } catch { await sleep(1000); } }
  expect(back, 'device did not come back within a minute').toBeTruthy();
  return back;
}
// Art-Net and sACN into output A, read back from /dmx.json.
async function inputStillRoutes(request) {
  const host = await deviceHost();
  const { art, sacn, info: d } = await universes(request);
  await prepInput(host);
  const sender = new UdpSender(host);
  try {
    const protos = [];
    if (d.protocol !== 1) protos.push(['artnet', ART_PORT, (i, b) => artDmxPacket(art, b, i), 61]);
    if (d.protocol !== 0) protos.push(['sacn', SACN_PORT, (i, b) => e131Packet(sacn, b, i), 62]);
    for (const [proto, port, make, val] of protos) {
      const data = Buffer.alloc(512); data[0] = val;
      // Stream for the whole polling window: right after a restart the first packets can be lost
      // (the box is still bringing its sockets up), and a 2.5 s burst could end before it listens.
      const streaming = streamFor(sender, port, (i) => make(i, data), { ms: 8000 });
      const got = await pollFor(() => dmx(request), (x) => x.ch[0] === val, { ms: 8000 });
      await streaming;
      expect(got.ch[0], `${proto} still reaches output A after the restore`).toBe(val);
    }
  } finally { sender.close(); }
}

test.describe('Config backup and restore (issue #108)', () => {
  test('GET /config.json is the whole config, matching /info.json', async ({ request }) => {
    const [f, d] = await Promise.all([exportCfg(request), info(request)]);
    expect(f.luxdmx).toBe('config');
    expect(f.format).toBe(1);
    for (const k of ['fw', 'mcu', 'board', 'host']) expect(typeof f[k], k).toBe('string');
    expect(f.mcu).toBe(d.mcu);
    expect(f.host).toBe(d.hostname);
    expect(f.secrets).toBe(false);
    expect(typeof f.labels).toBe('object');
    const c = f.config;
    expect(Object.keys(c).length, 'every setting, not a handful').toBeGreaterThan(80);
    expect(c.hostname).toBe(d.hostname);
    expect(c.protocol).toBe(d.protocol);
    expect(c.useeth).toBe(d.useEthernet);
    expect(c.o0_uni).toBe(d.outputs[0].uni);
    expect(c.o0_en).toBe(d.outputs[0].en);
    expect(typeof c.useeth, 'booleans are real booleans').toBe('boolean');
    expect(typeof c.o0_tx, 'numbers are real numbers').toBe('number');
    for (const s of ['otapw', 'wifipsk', 'appw']) expect(s in c, `${s} left out by default`).toBe(false);
  });

  test('passwords only when asked for', async ({ request }) => {
    const f = await exportCfg(request, true);
    expect(f.secrets).toBe(true);
    for (const s of ['otapw', 'wifipsk', 'appw']) expect(s in f.config, `${s} included`).toBe(true);
    expect(f.config.otapw).toBe((await info(request)).otapw);
  });

  test('/config offers the download, and it is the same file', async ({ page, request }) => {
    await openConfig(page);
    const link = page.locator('#backup-dl');
    await expect(link).toHaveAttribute('href', '/config.json?download=1');
    await page.locator('#backup-secrets').check();
    await expect(link).toHaveAttribute('href', '/config.json?download=1&secrets=1');
    await page.locator('#backup-secrets').uncheck();
    const [dl] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(dl.suggestedFilename()).toMatch(/-config\.json$/);
    const fromPage = JSON.parse(await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'));
    const direct = await exportCfg(request);
    expect(fromPage.config).toEqual(direct.config);
    await expect(page.locator('#restore-btn')).toBeDisabled();   // nothing picked yet
  });

  test('bad files are refused and nothing changes', async ({ request }) => {
    skipUnlessWrite();
    const before = await exportCfg(request, true);
    const up0 = await uptimeSec(request);
    const cases = [
      ['not JSON', '{"luxdmx":"config","config":{', 400],
      ['not a backup', { hello: 'world' }, 400],
      ['out of range', { luxdmx: 'config', mcu: before.mcu, board: before.board, config: { o1_uni: 3, o0_tx: 999 } }, 400],
      ['unknown key', { luxdmx: 'config', mcu: before.mcu, board: before.board, config: { o1_uni: 3, nosuchkey: 1 } }, 400],
      ['wrong type', { luxdmx: 'config', mcu: before.mcu, board: before.board, config: { useeth: 'maybe' } }, 400],
      ['other chip', { luxdmx: 'config', mcu: before.mcu === 'esp32' ? 'esp32s3' : 'esp32', board: before.board, config: { o1_uni: 3 } }, 409],
      ['other board', { luxdmx: 'config', mcu: before.mcu, board: 'some-other-board', config: { o1_uni: 3 } }, 409],
    ];
    for (const [name, body, code] of cases) {
      const r = await importCfg(request, body);
      expect(r.status, `${name}: ${JSON.stringify(r.j)}`).toBe(code);
      if (code === 409) { expect(r.j.error).toBe('board'); expect(r.j.mcu).toBe(before.mcu); }
    }
    await sleep(2000);
    expect(await uptimeSec(request), 'a refused file must not restart the device').toBeGreaterThanOrEqual(up0);
    expect((await exportCfg(request, true)).config, 'a refused file changed something').toEqual(before.config);
  });

  test('a partial file changes only its keys, then the full file restores everything', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(240_000);
    const orig = await exportCfg(request, true);
    const c = orig.config;
    const newUni = c.o1_uni === 7 ? 8 : 7;
    const newShort = c.artshort === 'backup-test' ? 'backup-test2' : 'backup-test';
    const labels = Object.keys(orig.labels).length ? orig.labels : null;
    try {
      // Partial: two keys, no booleans at all.
      const r = await importCfg(request, { luxdmx: 'config', mcu: orig.mcu, board: orig.board,
                                           config: { o1_uni: newUni, artshort: newShort } });
      expect(r.status, JSON.stringify(r.j)).toBe(200);
      expect(r.j.applied).toBe(2);
      await waitRestart(request);
      const after = (await exportCfg(request, true)).config;
      expect(after.o1_uni).toBe(newUni);
      expect(after.artshort).toBe(newShort);
      const changed = Object.keys(c).filter((k) => JSON.stringify(c[k]) !== JSON.stringify(after[k]));
      expect(changed.sort(), 'only the two keys in the file changed').toEqual(['artshort', 'o1_uni']);
      expect(after.useeth, 'useeth survived a file that does not mention it').toBe(c.useeth);
      await inputStillRoutes(request);
    } finally {
      // Full restore of the original file, which is also the round-trip test.
      const r = await importCfg(request, orig);
      expect(r.status, `restore: ${JSON.stringify(r.j)}`).toBe(200);
      expect(r.j.labels).toBe(true);
      await waitRestart(request);
    }
    const back = await exportCfg(request, true);
    expect(back.config, 'the full file put everything back').toEqual(c);
    if (labels) expect(back.labels).toEqual(labels);
    await inputStillRoutes(request);
  });

  test('a file from another board goes in with force=1 (same board here, so a no-op)', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(120_000);
    // Same values, different "board" stamp: refused without force, accepted with it. Nothing
    // actually differs, so the device just comes back as it was.
    const orig = await exportCfg(request, true);
    const file = { ...orig, board: 'some-other-board' };
    expect((await importCfg(request, file)).status).toBe(409);
    const r = await importCfg(request, file, true);
    expect(r.status, JSON.stringify(r.j)).toBe(200);
    await waitRestart(request);
    expect((await exportCfg(request, true)).config).toEqual(orig.config);
  });
});
