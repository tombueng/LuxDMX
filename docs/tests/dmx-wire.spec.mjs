// DMX output as measured on the wire by the RP2350 bench analyzer.
//
// The rest of the suite checks what the gateway *says* it transmits (/dmx.json outfps, the
// ArtPollReply refresh rate). This spec checks what a second box actually received off the XLR:
// slot values, start code, frame rate, framing errors on two independent taps, and whether the line
// keeps clocking at all. Those are the failures nobody can see from the device's own API, and the
// three regressions behind issues #64, #93 and #106 all live here.
//
// Needs the bench: gateway DMX out -> RS485 -> RP2350 analyzer (docs/rig-wiring-*.md). Skips itself
// when no analyzer answers, so a normal run without the rig stays green.
import { test, expect } from '@playwright/test';
import {
  deviceHost, prepInput, sleep, UdpSender, artDmxPacket, e131Packet, ART_PORT, SACN_PORT,
} from './lib/net.mjs';
import { info, dmx, waitForState } from './lib/device.mjs';
import {
  analyzerUp, NO_ANALYZER, anDmx, anMetrics, anReset, frameValues, wireHz, waitForWire,
  probeWiredOutput, driveArtnet,
} from './lib/analyzer.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';

const RATE_FPS = [40, 41.7, 33.3, 25, 20];          // matches ENUM_TXRATE
const CONTINUOUS = 0, DELTA = 1;
const HOLD = 0, BLACKOUT = 1, STOP = 2;             // matches LOSS_* in main.cpp

let host, up, snap, out, uni;

test.beforeAll(async ({ request }) => {
  host = await deviceHost();
  up = await analyzerUp();
  if (!up) return;
  snap = await info(request);
  await prepInput(host);
  out = await probeWiredOutput(host, snap);          // which output is the analyzer listening to?
  uni = out >= 0 ? snap.outputs[out].uni : -1;
});
test.beforeEach(() => {
  test.skip(!up, NO_ANALYZER);
  test.skip(out < 0, 'the analyzer hears no output of this gateway — check the RS485 wiring');
});

function skipUnlessWrite() {
  test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
}

// Whole /config form from a snapshot, overriding only the wired output. Every boolean has to be
// listed: handleConfigPost sets bools from checkbox presence, so a key left out is not "unchanged",
// it is set to false. Dropping `useeth` here would strand the device in its setup AP.
function configForm(s, overrides = {}) {
  const f = {
    protocol: String(s.protocol),
    hostname: s.hostname,
    otapw:    s.otapw,
    ledtype:  String(s.ledType),
    ledpin:   String(s.ledPin),
    ip: s.sip || '', gateway: s.gateway || '', subnet: s.subnet || '', dns: s.dns || '',
  };
  if (s.staticIp)      f.staticip = '1';
  if (s.useEthernet)   f.useeth   = '1';
  if (s.ethW5500)      f.ethon    = '1';
  if (s.artnetRdm)     f.artrdm   = '1';
  if (s.encReverse)    f.encrev   = '1';
  if (s.btnActiveHigh) f.btnah    = '1';
  s.outputs.forEach((o0, i) => {
    const o = i === out ? { ...o0, ...overrides } : o0;
    if (o.en) f[`o${i}_en`] = '1';                   // omitted key == disabled
    f[`o${i}_uni`]   = String(o.uni);
    f[`o${i}_port`]  = String(o.port);
    f[`o${i}_tx`]    = String(o.tx);
    f[`o${i}_rx`]    = String(o.rx);
    f[`o${i}_rts`]   = String(o.rts);
    f[`o${i}_merge`] = String(o.merge ?? 0);
    f[`o${i}_loss`]  = String(o.loss ?? 0);
    f[`o${i}_rate`]  = String(o.rate ?? 0);
    f[`o${i}_style`] = String(o.style ?? 0);
  });
  return f;
}
async function setOutput(request, overrides, pred) {
  await request.post('/config', { form: configForm(snap, overrides) });
  await waitForState(request, pred);
}

test.describe('DMX on the wire — the gateway always transmits (analyzer)', () => {
  test('the line carries a well-formed DMX frame: start code 0, 512 slots, real break', async () => {
    const f = await waitForWire((x) => x.sig === true, { ms: 6000 });
    expect(f, 'no frame on the wire at all').toBeTruthy();
    expect(f.sig, 'analyzer sees a live signal').toBe(true);
    expect(f.sc, 'null start code (0x00) = a DMX512 dimmer frame').toBe(0);
    expect(f.ch, 'full 512-slot frame').toBe(512);
    const m = await anMetrics();
    // E1.11 wants >= 92 us break, and receivers must accept 88. Anything under that is a broken
    // framing job that a lot of fixtures will drop.
    expect(m.anBreakUs, `break was ${m.anBreakUs} us`).toBeGreaterThanOrEqual(88);
  });

  test('Art-Net values arrive on the wire unchanged', async () => {
    const data = Buffer.alloc(512);
    data[0] = 11; data[1] = 22; data[41] = 200; data[511] = 255;   // first, mid and last slot
    const drive = driveArtnet(host, uni, data, { ms: 6000 });
    const hit = await waitForWire((_f, v) => v[0] === 11 && v[511] === 255, { ms: 6000 });
    await drive;
    const v = frameValues(hit);
    expect(v[0],   'slot 1').toBe(11);
    expect(v[1],   'slot 2').toBe(22);
    expect(v[41],  'slot 42').toBe(200);
    expect(v[511], 'slot 512 — the whole frame is clocked out, not a short one').toBe(255);
  });

  test('sACN values arrive on the wire unchanged', async () => {
    const data = Buffer.alloc(512);
    data[0] = 77; data[100] = 133; data[511] = 9;
    const sender = new UdpSender(host);
    // sACN universes are 1-based against the output's Art-Net universe: the firmware listens for
    // `uni + 1` and routes it back with routeFrame(universe - 1). Sending `uni` here silently lands
    // on the neighbouring output, which looks like "sACN is broken" but is just off by one.
    const drive = (async () => {
      const end = Date.now() + 6000;
      for (let s = 0; Date.now() < end; s++) {
        await sender.send(SACN_PORT, e131Packet(uni + 1, data, s));
        await sleep(25);
      }
    })();
    const hit = await waitForWire((_f, v) => v[0] === 77 && v[100] === 133, { ms: 6000 });
    await drive; sender.close();
    const v = frameValues(hit);
    expect(v[0],   'slot 1').toBe(77);
    expect(v[100], 'slot 101').toBe(133);
    expect(v[511], 'slot 512').toBe(9);
  });

  test('the gateway clocks a clean line: no framing errors on either tap', async () => {
    await anReset();                                  // zero both counters and start a fresh window
    const data = Buffer.alloc(512, 0x80);
    await driveArtnet(host, uni, data, { ms: 6000 });
    const m = await anMetrics();
    expect(m.anFrames, 'the PIO tap decoded frames during the window').toBeGreaterThan(100);
    expect(m.anFramingErr, 'PIO tap: framing errors').toBe(0);
    // The analyzer has a second, independent detector: a hardware UART used as ground truth, so a
    // framing claim does not rest on the PIO sampler alone (which has had its own bugs). It needs
    // its own tap wire and is not connected on every bench, so only assert on it when it is seeing
    // bytes — otherwise "0 errors" would just mean "0 frames looked at".
    if (m.gtFrames > 0) {
      expect(m.gtFramingErr, 'hardware-UART ground truth: framing errors').toBe(0);
      expect(m.gtOverrun,    'ground-truth UART overruns').toBe(0);
    }
  });

  // Issue #106: core 0 wrote the output buffer while core 1 was clocking it out, so a frame on the
  // wire could be half one input frame and half the next — channel combinations nobody ever sent
  // (the pyro case: arm from the old frame, fire from the new one). Feed frames where every slot
  // carries the SAME value and change it per frame: a torn frame is then simply a frame with two
  // different values in it.
  //
  // This samples the line over HTTP rather than catching every frame, so it is a regression guard
  // for a frequent tear (8.81% of frames before the fix), not a proof that no single frame tears.
  //
  // It only became a usable check once the analyzer stopped tearing itself: /api/dmx used to
  // serialise straight out of the shared frame buffer while core 1 overwrote it, which put ~2.9% of
  // *instrument* tears on top of whatever the gateway did. With the analyzer's publish path
  // seqlocked, 1865 sampled frames in a row came back clean, so 0 is the right expectation here.
  test('no torn frames on the wire (issue #106)', async ({ request }) => {
    const tornBefore = (await dmx(request)).tornSkips ?? 0;
    const sender = new UdpSender(host);
    const seen = new Map();                            // wire seq -> the frame's distinct values
    const drive = (async () => {
      const data = Buffer.alloc(512);
      const end = Date.now() + 9000;
      for (let s = 0; Date.now() < end; s++) {
        data.fill(1 + (s % 250));                      // uniform frame, new value every time
        await sender.send(ART_PORT, artDmxPacket(uni, data, s));
        await sleep(25);
      }
    })();
    const end = Date.now() + 9000;
    let tornReads = 0;
    while (Date.now() < end) {
      const f = await anDmx();
      if (!seen.has(f.seq)) seen.set(f.seq, new Set(frameValues(f)));
      tornReads = f.tr ?? 0;
      await sleep(40);
    }
    await drive; sender.close();

    const sampled = [...seen.values()];
    const torn = sampled.filter((vals) => vals.size > 1);
    // If the analyzer ever had to fall back to its previous snapshot, this run measured the
    // instrument as much as the gateway, and a clean result would not mean anything.
    expect(tornReads, 'the analyzer served a stale snapshot — its own seqlock gave up').toBe(0);
    expect(sampled.length, 'sampled enough distinct frames to be meaningful').toBeGreaterThan(20);
    expect(torn.length,
      `${torn.length}/${sampled.length} frames on the wire mixed two input frames`).toBe(0);
    // The seqlock's own escape hatch: after 8 failed copy attempts it gives up and skips the frame
    // rather than transmitting a torn one. That should not be happening at a normal input rate.
    const tornAfter = (await dmx(request)).tornSkips ?? 0;
    expect(tornAfter - tornBefore, 'frames the gateway had to skip to avoid tearing').toBe(0);
  });
});

test.describe('DMX on the wire — rate, style and signal loss (LUXDMX_WRITE=1)', () => {
  test.afterAll(async ({ request }) => {
    if (!WRITE || !up || out < 0 || !snap) return;
    const o = snap.outputs[out];
    await request.post('/config', { form: configForm(snap) });
    await waitForState(request, (d) =>
      d.outputs[out].rate === (o.rate ?? 0) &&
      d.outputs[out].style === (o.style ?? 0) &&
      d.outputs[out].loss === (o.loss ?? 0));
  });

  // The device already counts its own transmitted frames, and output-rate.spec.mjs asserts on that.
  // This is the independent half: the frames were not just scheduled, they arrived.
  test('the configured rate is the rate on the wire (issue #93)', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(180_000);

    await setOutput(request, { rate: 0, style: CONTINUOUS }, (d) => d.outputs[out].rate === 0);
    const at40 = await wireHz({ ms: 6000 });
    expect(at40, `measured ${at40.toFixed(1)} fps on the wire, wanted 40`).toBeGreaterThan(38);
    expect(at40, `measured ${at40.toFixed(1)} fps on the wire, wanted 40`).toBeLessThan(42);

    await setOutput(request, { rate: 2, style: CONTINUOUS }, (d) => d.outputs[out].rate === 2);
    const at33 = await wireHz({ ms: 6000 });
    expect(at33, `measured ${at33.toFixed(1)} fps on the wire, wanted 33.3`).toBeGreaterThan(31.5);
    expect(at33, `measured ${at33.toFixed(1)} fps on the wire, wanted 33.3`).toBeLessThan(35);

    await setOutput(request, { rate: 3, style: CONTINUOUS }, (d) => d.outputs[out].rate === 3);
    const at25 = await wireHz({ ms: 6000 });
    expect(at25, `measured ${at25.toFixed(1)} fps on the wire, wanted 25`).toBeGreaterThan(23.5);
    expect(at25, `measured ${at25.toFixed(1)} fps on the wire, wanted 25`).toBeLessThan(26.5);
    expect(RATE_FPS[3]).toBe(25);
  });

  test('Delta makes the wire follow the source instead of free-running', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(180_000);
    const data = Buffer.alloc(512, 0x40);

    // Continuous at 40 fps fed from a 25 fps console: the wire stays at 40 and repeats frames.
    await setOutput(request, { rate: 0, style: CONTINUOUS },
      (d) => d.outputs[out].style === CONTINUOUS && d.outputs[out].rate === 0);
    const driveC = driveArtnet(host, uni, data, { ms: 14000, fps: 25 });
    await sleep(3000);
    const cont = await wireHz({ ms: 8000 });
    await driveC;
    expect(cont, `continuous ignored the 25 fps source (wire ${cont.toFixed(1)} fps)`).toBeGreaterThan(38);

    // Same source, Delta: the wire should drop to the console's rate.
    await setOutput(request, { rate: 0, style: DELTA }, (d) => d.outputs[out].style === DELTA);
    const driveD = driveArtnet(host, uni, data, { ms: 14000, fps: 25 });
    await sleep(3000);
    const delta = await wireHz({ ms: 8000 });
    await driveD;
    expect(delta, `delta followed the source down (wire ${delta.toFixed(1)} fps)`).toBeLessThan(cont - 5);
    expect(Math.abs(delta - 25), `delta tracked 25 fps (wire ${delta.toFixed(1)})`).toBeLessThan(4);
  });

  // The one the suite has never been able to assert: STOP is defined by the line going quiet, which
  // is invisible from the device's own API. docs/tests/README.md said this needed a logic analyzer.
  test('signal-loss STOP really stops the clock, HOLD and BLACKOUT keep it running', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(240_000);
    const data = Buffer.alloc(512);
    data[0] = 210; data[41] = 120; data[511] = 60;

    // HOLD: source goes away, the line keeps clocking the last frame it had.
    await setOutput(request, { loss: HOLD, rate: 0, style: CONTINUOUS },
      (d) => d.outputs[out].loss === HOLD);
    await driveArtnet(host, uni, data, { ms: 5000 });
    await sleep(4000);                                  // past the 2.5 s source timeout
    const holdHz = await wireHz({ ms: 4000 });
    const holdF = await anDmx();
    expect(holdHz, `HOLD keeps transmitting (wire ${holdHz.toFixed(1)} fps)`).toBeGreaterThan(38);
    expect(frameValues(holdF)[0], 'HOLD keeps the last value, it does not zero it').toBe(210);
    expect(frameValues(holdF)[511], 'HOLD keeps the last value').toBe(60);

    // BLACKOUT: still clocking, all slots zero.
    await setOutput(request, { loss: BLACKOUT, rate: 0, style: CONTINUOUS },
      (d) => d.outputs[out].loss === BLACKOUT);
    await driveArtnet(host, uni, data, { ms: 5000 });
    await sleep(4000);
    const blkHz = await wireHz({ ms: 4000 });
    const blkV = frameValues(await anDmx());
    expect(blkHz, `BLACKOUT keeps transmitting (wire ${blkHz.toFixed(1)} fps)`).toBeGreaterThan(38);
    expect(Math.max(...blkV), 'BLACKOUT drives every slot to 0').toBe(0);

    // STOP: the line stops. No frames, and the analyzer drops its signal flag.
    await setOutput(request, { loss: STOP, rate: 0, style: CONTINUOUS },
      (d) => d.outputs[out].loss === STOP);
    await driveArtnet(host, uni, data, { ms: 5000 });
    const live = await wireHz({ ms: 3000 });
    expect(live, 'still clocking while the source is up').toBeGreaterThan(30);
    await sleep(5000);                                  // past the timeout, with no source
    const seqBefore = (await anDmx()).seq;
    const stopHz = await wireHz({ ms: 4000 });
    const seqAfter = (await anDmx()).seq;
    // Two counters, because this is the assertion the suite never had: no frames decoded off the
    // line, and the published frame view stands still with them. Not the analyzer's own `sig` flag,
    // which stayed true on a demonstrably dead line (it is driven by a bus-activity timer that a
    // silent-but-idle RS485 pair keeps feeding), so it would have passed this test for free.
    expect(stopHz, `STOP stops the line (wire ${stopHz.toFixed(1)} fps)`).toBeLessThan(1);
    expect(seqAfter - seqBefore, 'no further frames published while stopped').toBe(0);
  });
});
