// RDM on the wire, checked against the RP2350 responder simulator on the bench.
//
// /rdm.json tells you what the controller believes: it discovered 64 devices, it sent a SET, the
// fixture is identifying. None of that proves anything reached a fixture. The simulator is the
// other end of every one of those transactions, so this spec asks it: did you actually get muted,
// did your DMX start address really change, are you identifying? Plus the thing issue #64 was
// about, which no HTTP endpoint can answer: does DMX keep clocking at full rate while RDM runs.
//
// Needs the bench: gateway DMX out -> RS485 -> RP2350 (docs/rig-wiring-*.md). Skips itself when the
// analyzer does not answer. Bus-driving tests gate behind LUXDMX_WRITE=1 and restore what they
// change, the same way rdm-trigger.spec.mjs does.
import { test, expect } from '@playwright/test';
import { deviceHost, prepInput, sleep } from './lib/net.mjs';
import { info } from './lib/device.mjs';
import {
  analyzerUp, NO_ANALYZER, anStatus, anMetrics, anFixtures, anCapture, drainCapture, anReset,
  anUnmute, wireHz, probeWiredOutput, CC, PID, EV,
} from './lib/analyzer.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
const RATE_FPS = [40, 41.7, 33.3, 25, 20];

let host, up, snap, out;

test.beforeAll(async ({ request }) => {
  host = await deviceHost();
  up = await analyzerUp();
  if (!up) return;
  snap = await info(request);
  await prepInput(host);
  out = await probeWiredOutput(host, snap);       // the RDM line is the output the simulator hears
});
test.beforeEach(() => {
  test.skip(!up, NO_ANALYZER);
  test.skip(out < 0, 'the analyzer hears no output of this gateway — check the RS485 wiring');
});

const rdm = async (request) => (await request.get('/rdm.json')).json();

// Run one discovery sweep on the wired line and wait for it to finish.
async function discover(request) {
  await request.get('/rdm/discover?line=' + out);
  await expect.poll(async () => (await rdm(request)).discovering, { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => (await rdm(request)).discovering, { timeout: 90_000 }).toBe(false);
  return rdm(request);
}
const byUid = (list) => new Map(list.map((f) => [f.uid, f]));

test.describe('RDM on the wire — the simulator answers (analyzer)', () => {
  test('the responder simulator is present on the bus', async () => {
    const s = await anStatus();
    expect(s.fixtures, 'virtual fixtures on the bus').toBeGreaterThan(0);
    expect(s.bus.state, 'the simulator sees bus traffic from the gateway').toBe('active');
  });

  test('the gateway lists no fixture the simulator does not have', async ({ request }) => {
    const j = await rdm(request);
    const mine = j.devices.filter((d) => d.uni === snap.outputs[out].uni);
    test.skip(mine.length === 0, 'no fixtures discovered on this line yet — run with LUXDMX_WRITE=1');
    const sim = byUid(await anFixtures());
    for (const d of mine) {
      expect(sim.has(d.uid), `${d.uid} is in the gateway's TOD but not on the bus`).toBe(true);
      // The address the controller reports must be the one the responder is actually sitting on.
      expect(d.addr, `${d.uid} start address`).toBe(sim.get(d.uid).address);
    }
  });
});

test.describe('RDM on the wire — transactions (LUXDMX_WRITE=1)', () => {
  test('discovery finds every simulated fixture, and the wire shows the E1.20 traffic', async ({ request }) => {
    test.skip(!WRITE, 'drives the bus: set LUXDMX_WRITE=1 to run');
    test.setTimeout(240_000);

    const sim = await anFixtures();
    const cap0 = (await anCapture(0)).seq;          // cursor: only look at what this sweep produces
    await anUnmute();                               // forget the last sweep, make this one real work
    const m0 = await anMetrics();

    await request.get('/rdm/discover?line=' + out);
    await expect.poll(async () => (await rdm(request)).discovering, { timeout: 20_000 }).toBe(true);
    // Read the log while the sweep runs, not after: the ring laps every ~2 s at this traffic rate.
    const ev = await drainCapture(cap0, async () => !(await rdm(request)).discovering, { ms: 120_000 });
    const j = await rdm(request);

    const m1 = await anMetrics();
    expect(m1.rdmReq - m0.rdmReq, 'RDM requests seen on the wire').toBeGreaterThan(0);
    expect(m1.resp   - m0.resp,   'responses the simulator sent back').toBeGreaterThan(0);

    // The controller found every fixture the simulator presents, up to its own device cap.
    const expected = Math.min(sim.length, snap.rdmMax ?? sim.length);
    const found = j.devices.filter((d) => d.uni === snap.outputs[out].uni);
    expect(found.length, `discovered ${found.length} of ${expected} fixtures on the bus`).toBe(expected);
    expect(m1.discovered, 'fixtures the simulator was actually muted by').toBe(expected);

    // And it was real E1.20 discovery on the wire, not a replay of a cached table. The simulator
    // logs the branch *responses* it sends (a DISC_UNIQUE_BRANCH request has no logged counterpart,
    // it is the reply that proves a fixture answered inside the turnaround window), then the mute
    // it was sent, then the GETs the controller uses to fill in the fixture.
    const req = ev.filter((e) => e.k === EV.REQ);
    const resp = ev.filter((e) => e.k === EV.RESP);
    expect(resp.some((e) => e.cc === CC.DISC_RESP && e.p === PID.DISC_UNIQUE_BRANCH),
      'a fixture answered a DISC_UNIQUE_BRANCH inside the turnaround').toBe(true);
    expect(req.filter((e) => e.cc === CC.DISC && e.p === PID.DISC_MUTE).length,
      'every discovered fixture got muted').toBe(expected);
    expect(req.some((e) => e.cc === CC.GET && e.p === PID.DEVICE_INFO),
      'the controller read DEVICE_INFO off each fixture').toBe(true);
    expect(req.every((e) => [CC.DISC, CC.GET, CC.SET].includes(e.cc)),
      'every request carried a valid command class').toBe(true);
  });

  test('SET DMX_START_ADDRESS actually moves the fixture', async ({ request }) => {
    test.skip(!WRITE, 'drives the bus: set LUXDMX_WRITE=1 to run');
    test.setTimeout(180_000);

    // Use a fixture both ends agree on, so the controller has it in its TOD.
    const sim = byUid(await anFixtures());
    const known = (await rdm(request)).devices.filter((d) => sim.has(d.uid));
    test.skip(known.length === 0, 'nothing discovered yet — run the discovery test first');
    const target = known[0];
    const was = sim.get(target.uid).address;
    const want = was === 100 ? 200 : 100;

    const r = await request.get(`/rdm/setaddr?uid=${target.uid}&addr=${want}`);
    expect(r.ok(), 'the controller accepted the SET').toBeTruthy();

    // The proof is inside the responder, not in the controller's echo of its own request.
    await expect.poll(async () => byUid(await anFixtures()).get(target.uid)?.address,
      { timeout: 30_000, message: `${target.uid} never moved to address ${want}` }).toBe(want);

    await request.get(`/rdm/setaddr?uid=${target.uid}&addr=${was}`);      // put it back
    await expect.poll(async () => byUid(await anFixtures()).get(target.uid)?.address,
      { timeout: 30_000 }).toBe(was);
  });

  test('IDENTIFY reaches the fixture and switches off again', async ({ request }) => {
    test.skip(!WRITE, 'drives the bus: set LUXDMX_WRITE=1 to run');
    test.setTimeout(180_000);

    const sim = byUid(await anFixtures());
    const known = (await rdm(request)).devices.filter((d) => sim.has(d.uid));
    test.skip(known.length === 0, 'nothing discovered yet — run the discovery test first');
    const uid = known[0].uid;

    await request.get(`/rdm/identify?uid=${uid}&on=1`);
    await expect.poll(async () => byUid(await anFixtures()).get(uid)?.identify,
      { timeout: 30_000, message: `${uid} never started identifying` }).toBe(true);

    await request.get(`/rdm/identify?uid=${uid}&on=0`);
    await expect.poll(async () => byUid(await anFixtures()).get(uid)?.identify,
      { timeout: 30_000, message: `${uid} kept identifying` }).toBe(false);
  });

  // Issue #64: RDM used to be interleaved badly enough that the DMX line stuttered while a sweep
  // ran. The controller's own frame counter cannot show that credibly (it counts what it scheduled),
  // so measure the line while a full 64-fixture discovery is in flight.
  //
  // DMX does not stay at exactly 40 fps here, and it should not: RDM shares one half-duplex pair, so
  // every request plus its turnaround is time the line cannot be clocking DMX. Measured on this rig,
  // a sweep runs ~75 requests/s and costs about 12% of the frame rate (40.3 -> ~35.3). The guard is
  // that the line keeps running and recovers, not that RDM is free.
  test('DMX keeps clocking through a discovery sweep, and recovers after it', async ({ request }) => {
    test.skip(!WRITE, 'drives the bus: set LUXDMX_WRITE=1 to run');
    test.setTimeout(240_000);

    const want = RATE_FPS[snap.outputs[out].rate ?? 0];
    await anReset();
    const idle = await wireHz({ ms: 4000 });
    expect(idle, `idle wire rate ${idle.toFixed(1)} fps`).toBeGreaterThan(want * 0.95);

    await request.get('/rdm/discover?line=' + out);
    await expect.poll(async () => (await rdm(request)).discovering, { timeout: 20_000 }).toBe(true);
    const during = await wireHz({ ms: 8000 });          // measured while RDM is on the bus
    await expect.poll(async () => (await rdm(request)).discovering, { timeout: 90_000 }).toBe(false);

    const after = await wireHz({ ms: 4000 });
    const m = await anMetrics();

    expect(during, `wire ran at ${during.toFixed(1)} fps during discovery, configured ${want}`)
      .toBeGreaterThan(want * 0.8);
    expect(after, `wire back to ${after.toFixed(1)} fps after the sweep, configured ${want}`)
      .toBeGreaterThan(want * 0.95);
    // RDM turnarounds must not leave broken DMX frames behind either.
    expect(m.anFramingErr, 'framing errors during the sweep (PIO tap)').toBe(0);
    if (m.gtFrames > 0) {                              // second tap is only wired on some benches
      expect(m.gtFramingErr, 'framing errors during the sweep (ground truth)').toBe(0);
    }
    await sleep(500);
  });
});
