// HTTP RDM trigger endpoints — a reliable, scriptable alternative to the WS
// control channel (the WS path can drop a trigger under load; these never do).
//   GET /rdm/discover
//   GET /rdm/setaddr?uid=MMMM:DDDDDDDD&addr=N
//   GET /rdm/identify?uid=MMMM:DDDDDDDD&on=1
//   GET /rdm/setpers?uid=MMMM:DDDDDDDD&pers=N        (the sequencer's rig check sets a mode)
//   GET /rdm/setlabel?uid=MMMM:DDDDDDDD&label=text   (and a light's label)
//
// The validation paths (bad/missing params) never queue a bus action, so they
// run by default. The success paths actually queue an RDM transaction on the
// wire (discover mutes fixtures transiently; setaddr/identify reprogram a
// fixture), so they are opt-in via LUXDMX_WRITE=1 to avoid perturbing a live
// bench bus. None of these change device config or reboot.
//
// The RMT-clocked DMX output and the on-wire RDM timing this feature is really
// about (0 framing errors under network load — issue #64 — and discovery/GET/SET
// round-trips) are only observable on the wire. They are validated against the
// RP2350 analyzer + responder rig, not Playwright, the same way the Art-Net
// per-loop latency and signal-loss STOP are called out as out of e2e scope.
import { test, expect } from '@playwright/test';

const WRITE = process.env.LUXDMX_WRITE === '1';
const UID = '4C58:0000ABCD';   // arbitrary test UID (LuxDMX manufacturer id 0x4C58)

async function json(res) {
  expect(res.headers()['content-type']).toContain('application/json');
  return res.json();
}

test.describe('RDM controller REST shape', () => {
  test('/rdm.json reports controller state + the discovered-device list', async ({ request }) => {
    const r = await request.get('/rdm.json');
    expect(r.ok()).toBeTruthy();
    const j = await json(r);
    expect(typeof j.available).toBe('boolean');   // is an RDM-capable output configured
    expect(typeof j.busy).toBe('boolean');        // mid-transaction
    expect(Array.isArray(j.devices)).toBeTruthy();// the TOD (table of devices)
  });
});

test.describe('RDM trigger — validation (non-mutating, always runs)', () => {
  test('setaddr without uid → 400 {ok:false}', async ({ request }) => {
    const r = await request.get('/rdm/setaddr?addr=5');
    expect(r.status()).toBe(400);
    expect((await r.json()).ok).toBe(false);
  });

  test('setaddr with a malformed uid → 400', async ({ request }) => {
    const r = await request.get('/rdm/setaddr?uid=notauid&addr=5');
    expect(r.status()).toBe(400);
  });

  test('setaddr with an out-of-range address → 400', async ({ request }) => {
    for (const addr of [0, 513, 9999]) {
      const r = await request.get(`/rdm/setaddr?uid=${UID}&addr=${addr}`);
      expect(r.status(), `addr=${addr} must be rejected`).toBe(400);
    }
  });

  test('setaddr without an address → 400', async ({ request }) => {
    const r = await request.get(`/rdm/setaddr?uid=${UID}`);
    expect(r.status()).toBe(400);
  });

  test('identify without uid → 400', async ({ request }) => {
    const r = await request.get('/rdm/identify?on=1');
    expect(r.status()).toBe(400);
  });

  test('setpers without uid, without a mode, or with a mode out of range → 400', async ({ request }) => {
    for (const q of ['pers=2', `uid=${UID}`, `uid=${UID}&pers=0`, `uid=${UID}&pers=256`, 'uid=notauid&pers=2']) {
      const r = await request.get(`/rdm/setpers?${q}`);
      expect(r.status(), q).toBe(400);
    }
  });

  test('setlabel without uid or without a label → 400', async ({ request }) => {
    for (const q of ['label=x', `uid=${UID}`]) {
      const r = await request.get(`/rdm/setlabel?${q}`);
      expect(r.status(), q).toBe(400);
    }
  });
});

test.describe('RDM trigger — queues a bus action (opt-in)', () => {
  test.skip(!WRITE, 'drives the RDM bus; set LUXDMX_WRITE=1 to enable');

  test('discover → 200 {ok:true, op:"discover"}', async ({ request }) => {
    const r = await request.get('/rdm/discover');
    expect(r.ok()).toBeTruthy();
    const j = await json(r);
    expect(j.ok).toBe(true);
    expect(j.op).toBe('discover');
  });

  test('setaddr with a valid uid + address → 200 {ok:true, op:"setaddr"}', async ({ request }) => {
    const r = await request.get(`/rdm/setaddr?uid=${UID}&addr=12`);
    expect(r.ok()).toBeTruthy();
    const j = await json(r);
    expect(j.ok).toBe(true);
    expect(j.op).toBe('setaddr');
  });

  test('setpers and setlabel with a valid uid → 200 {ok:true, op}', async ({ request }) => {
    for (const [path, op] of [[`/rdm/setpers?uid=${UID}&pers=1`, 'setpers'], [`/rdm/setlabel?uid=${UID}&label=${encodeURIComponent('Test label')}`, 'setlabel']]) {
      const r = await request.get(path);
      expect(r.ok(), path).toBeTruthy();
      const j = await json(r);
      expect(j.ok).toBe(true);
      expect(j.op).toBe(op);
    }
  });

  test('identify on/off → 200 {ok:true, op:"identify"}', async ({ request }) => {
    for (const on of [1, 0]) {
      const r = await request.get(`/rdm/identify?uid=${UID}&on=${on}`);
      expect(r.ok(), `on=${on}`).toBeTruthy();
      const j = await json(r);
      expect(j.ok).toBe(true);
      expect(j.op).toBe('identify');
    }
  });
});
