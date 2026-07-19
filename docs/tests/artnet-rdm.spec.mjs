// RDM over Art-Net (E1.20 over Art-Net 4). Drives the device as an Art-Net RDM
// controller and asserts the node side: ArtPoll -> ArtPollReply, ArtTodRequest ->
// ArtTodData (the Table of Devices), and ArtRdm GET/SET pass-through to a fixture.
//
// Read-only paths run by default: ArtPoll is pure network, and ArtTodRequest just
// returns the node's cached TOD (no new bus transaction). The paths that actually
// drive the RDM wire (ArtRdm GET/SET, AtcFlush re-discovery) mute/reprogram fixtures
// on a live bench bus, so they are opt-in via LUXDMX_WRITE=1, same as rdm-trigger.
//
// The on-wire proof that matters most for this feature -- that RDM traffic does NOT
// slow the DMX output (before: a discovery dropped the wire to ~4-6 fps for ~2.3 s;
// after: it holds ~30-40 fps with 0 framing errors) -- is measured on the RP2350
// analyzer rig (docs/rdm.md), not Playwright, which can't see the wire. Here we use
// the device's self-reported transmit rate (/dmx.json outfps) as a coarse proxy.
import { test, expect } from '@playwright/test';
import { deviceHost, sleep, artDmxPacket, UdpSender, ART_PORT } from './lib/net.mjs';
import { ArtRdmClient, parseUidStr, CC_GET, PID_DEVICE_INFO,
         AC_MERGE_HTP0, AC_MERGE_LTP0, AC_CANCEL_MERGE, AC_BQP0 } from './lib/artrdm.mjs';
import { info, dmx } from './lib/device.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';

async function json(res) {
  expect(res.headers()['content-type']).toContain('application/json');
  return res.json();
}
async function rdmState(request) { return json(await request.get('/rdm.json')); }

test.describe('Art-Net RDM — REST shape (always)', () => {
  test('/rdm.json exposes the Art-Net RDM node state + request counters', async ({ request }) => {
    const j = await rdmState(request);
    expect(typeof j.artnetRdm).toBe('boolean');    // the enable toggle (config artrdm)
    expect(typeof j.artPort).toBe('number');        // the RDM output's Art-Net port-address
    expect(typeof j.discovering).toBe('boolean');   // an incremental discovery is running
    for (const k of ['artTodReqs', 'artRdmReqs', 'artFlushes', 'artPolls'])
      expect(typeof j[k], k).toBe('number');
    expect(typeof j.bqPolicy, 'BackgroundQueuePolicy exposed').toBe('number');
    expect(Array.isArray(j.outputs), 'per-output merge exposed for the RDM tab').toBe(true);
    for (const o of j.outputs) { expect(typeof o.uni).toBe('number'); expect(typeof o.merge).toBe('number'); }
  });
});

test.describe('Art-Net RDM — node (read-only wire, always)', () => {
  let host, c;
  test.beforeAll(async () => { host = await deviceHost(); c = new ArtRdmClient(host); await c.ready; });
  test.afterAll(async () => { await c?.close(); });

  test('ArtPoll -> ArtPollReply advertises the node + its output ports', async ({ request }) => {
    const reply = await c.poll();
    expect(reply, 'no ArtPollReply received').toBeTruthy();
    expect(reply.ip).toBe(host);                    // the reply carries our IP
    expect(reply.numPorts).toBeGreaterThanOrEqual(1);
    expect(reply.portTypes[0] & 0x80, 'port 0 is a DMX output').toBe(0x80);
  });

  test('ArtPollReply advertises RDM-capable + BackgroundQueue support + the queue policy', async () => {
    const reply = await c.poll();
    expect(reply, 'no ArtPollReply received').toBeTruthy();
    expect(reply.status1 & 0x02, 'Status1 bit1: node is RDM capable').toBe(0x02);
    expect(reply.status3 & 0x02, 'Status3 bit1: BackgroundQueue supported').toBe(0x02);
    expect(typeof reply.bqPolicy, 'BackgroundQueuePolicy byte present in reply').toBe('number');
  });

  // Issue #93: the gateway used to leave RefreshRate at 0 (which a controller reads as the 44 Hz
  // DMX512 ceiling) while actually clocking 40 Hz, and left GoodOutputB bit6 clear, which claims
  // "delta" output when we in fact free-run. Both made us oversold and lied about our timing, so
  // pin them to what the wire really does.
  test('ArtPollReply reports the real output rate, style and failsafe (issue #93)', async ({ request }) => {
    const reply = await c.poll();
    expect(reply, 'no ArtPollReply received').toBeTruthy();

    // RefreshRate must match the rate we actually clock DMX at, as reported by /dmx.json outfps.
    const d = await dmx(request);
    const outFps = d.outfps.find((f) => f > 0);
    expect(reply.refreshRate, 'RefreshRate advertised').toBeGreaterThan(0);
    expect(reply.refreshRate, 'RefreshRate must not exceed the DMX512 ceiling').toBeLessThanOrEqual(44);
    if (outFps) {
      expect(Math.abs(reply.refreshRate - outFps),
        `advertised ${reply.refreshRate} Hz vs measured ${outFps} fps`).toBeLessThanOrEqual(2);
    }

    // We free-run on a fixed timer, so the honest answer is "continuous", never "delta".
    expect(reply.outputStyle, 'GoodOutputB bit6 = continuous output style').toBe('continuous');

    // Status3 bits7-6 mirror the port's signal-loss policy: 0 = hold last state, 1 = outputs to zero.
    const loss = (await info(request)).outputs[0].loss;
    expect(reply.failsafe, `failsafe state matches lossMode ${loss}`).toBe(loss === 1 ? 1 : 0);
  });

  test('ArtTodRequest -> ArtTodData returns the TOD matching /rdm.json', async ({ request }) => {
    const j = await rdmState(request);
    test.skip(!j.available, 'no RDM-capable output configured on this device');
    const tod = await c.todRequest(j.artPort);
    expect(tod, 'no ArtTodData received').toBeTruthy();
    expect(tod.portAddress).toBe(j.artPort);
    expect(tod.uidTotal).toBe(j.devices.length);    // TOD size agrees with the controller table
    // every UID in ArtTodData is one the controller knows about
    const known = new Set(j.devices.map((d) => d.uid.toUpperCase()));
    for (const u of tod.uids) {
      const s = u[0].toString(16).padStart(4, '0').toUpperCase() + ':' + u[1].toString(16).padStart(8, '0').toUpperCase();
      expect(known.has(s), `${s} in ArtTodData but not /rdm.json`).toBeTruthy();
    }
  });
});

test.describe('Art-Net RDM — GET/SET pass-through (LUXDMX_WRITE=1)', () => {
  test.skip(!WRITE, 'wire-mutating: set LUXDMX_WRITE=1 to run against the bench bus');
  let host, c;
  test.beforeAll(async () => { host = await deviceHost(); c = new ArtRdmClient(host); await c.ready; });
  test.afterAll(async () => { await c?.close(); });

  test('ArtRdm GET DEVICE_INFO round-trips to a fixture', async ({ request }) => {
    const j = await rdmState(request);
    test.skip(!j.devices.length, 'no fixtures discovered on the bus');
    const uid = parseUidStr(j.devices[0].uid);
    const info = await c.deviceInfo(j.artPort, uid);
    expect(info, 'no ArtRdm reply').toBeTruthy();
    expect(info.footprint).toBeGreaterThan(0);
    expect(info.dmxAddr).toBeGreaterThanOrEqual(1);
  });

  test('ArtRdm SET DMX_START_ADDRESS is applied and reads back', async ({ request }) => {
    const j = await rdmState(request);
    test.skip(!j.devices.length, 'no fixtures discovered on the bus');
    const uid = parseUidStr(j.devices[0].uid);
    const before = (await c.deviceInfo(j.artPort, uid)).dmxAddr;
    const target = before === 100 ? 42 : 100;
    expect(await c.setDmxAddress(j.artPort, uid, target)).toBeTruthy();
    const after = await c.deviceInfo(j.artPort, uid);
    expect(after.dmxAddr).toBe(target);
    await c.setDmxAddress(j.artPort, uid, before);   // restore
  });

  test('AtcFlush triggers a re-discovery and the TOD repopulates', async ({ request }) => {
    const j0 = await rdmState(request);
    await c.todFlush(j0.artPort);
    // discovery is incremental (a few seconds); wait for it to run and finish
    await sleep(1000);
    const busy = await rdmState(request);
    // it either flagged discovering, or already finished fast; then it settles (a full-universe
    // rediscovery of a large responder set can take a while)
    await expect.poll(async () => (await rdmState(request)).discovering, { timeout: 40000 }).toBe(false);
    const j1 = await rdmState(request);
    expect(j1.artFlushes).toBeGreaterThan(j0.artFlushes);
    expect(j1.scanned).toBeTruthy();
  });

  test('RDM traffic does not stop the DMX output (outfps stays up during a flush)', async ({ request }) => {
    const j = await rdmState(request);
    const sender = new UdpSender(host);
    // stream Art-Net so the device is actively transmitting
    const streaming = (async () => {
      const end = Date.now() + 9000; let seq = 0;
      const data = Buffer.alloc(512, 128);
      while (Date.now() < end) { await sender.send(ART_PORT, artDmxPacket(j.artPort, data, seq++)); await sleep(25); }
    })();
    await sleep(1500);
    const base = (await json(await request.get('/dmx.json'))).outfps;
    await c.todFlush(j.artPort);                      // heavy RDM (full re-discovery) mid-stream
    let lowest = 99;
    for (let i = 0; i < 20; i++) { lowest = Math.min(lowest, ...((await json(await request.get('/dmx.json'))).outfps)); await sleep(300); }
    await streaming; sender.close();
    // the device keeps transmitting all the way through -- never freezes to a crawl
    expect(Math.min(...base), 'baseline outfps').toBeGreaterThan(20);
    expect(lowest, 'outfps must not collapse during discovery').toBeGreaterThan(20);
  });
});

// ArtAddress remote port config: a console (DMX-Workshop's "Configure Port" dialog) sets the port's
// merge mode and the node's BackgroundQueuePolicy over the network. These mutate persisted config, so
// they are opt-in and restore what they change.
test.describe('Art-Net RDM ArtAddress remote config (LUXDMX_WRITE=1)', () => {
  test.skip(!WRITE, 'mutates node config: set LUXDMX_WRITE=1 to run');
  let host, c;
  test.beforeAll(async () => { host = await deviceHost(); c = new ArtRdmClient(host); await c.ready; });
  test.afterAll(async () => { await c?.close(); });

  const out0Merge = async (request) => (await json(await request.get('/info.json'))).outputs[0].merge;

  test('ArtAddress sets the port merge mode (HTP / LTP / cancel), applied live + read back', async ({ request }) => {
    const before = await out0Merge(request);
    await c.address(1, AC_MERGE_HTP0);
    await expect.poll(() => out0Merge(request), { timeout: 5000 }).toBe(1);   // MERGE_HTP
    expect((await c.poll()).goodOutput[0] & 0x02, 'GoodOutput bit1 clear = HTP').toBe(0);
    await c.address(1, AC_MERGE_LTP0);
    await expect.poll(() => out0Merge(request), { timeout: 5000 }).toBe(2);   // MERGE_LTP
    expect((await c.poll()).goodOutput[0] & 0x02, 'GoodOutput bit1 set = LTP').toBe(0x02);  // the read-back a console shows
    await c.address(1, AC_CANCEL_MERGE);
    await expect.poll(() => out0Merge(request), { timeout: 5000 }).toBe(0);   // MERGE_OFF
    await c.address(1, before === 1 ? AC_MERGE_HTP0 : before === 2 ? AC_MERGE_LTP0 : AC_CANCEL_MERGE);  // restore
  });

  test('ArtAddress sets the BackgroundQueuePolicy, reflected in /rdm.json + ArtPollReply', async ({ request }) => {
    const before = (await rdmState(request)).bqPolicy;
    await c.address(1, AC_BQP0 + 2);                                          // policy 2 = WARNING
    await expect.poll(async () => (await rdmState(request)).bqPolicy, { timeout: 5000 }).toBe(2);
    const reply = await c.poll();
    expect(reply.bqPolicy, 'policy advertised back in ArtPollReply byte 228').toBe(2);
    await c.address(1, AC_BQP0 + (before ?? 4));                              // restore (default 4 = off)
  });
});
