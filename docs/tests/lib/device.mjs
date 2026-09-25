// REST helpers built on the Playwright `request` fixture, plus config-form
// round-trip utilities. baseURL comes from playwright.config.mjs.
import { sleep } from './net.mjs';

export async function info(request)    { return (await request.get('/info.json')).json(); }
export async function dmx(request)     { return (await request.get('/dmx.json')).json(); }
export async function senders(request) { return (await request.get('/senders.json')).json(); }
export async function changelog(request) { return (await request.get('/log.json')).json(); }

// The Art-Net universe of output A, and the matching sACN universe (+1).
export async function universes(request) {
  const d = await info(request);
  const art = d.outputs?.[0]?.uni ?? d.universe ?? 0;
  return { art, sacn: art + 1, info: d };
}

// Retry `fetch()` until `pred(result)` is truthy (or time out). Returns the
// last result so the caller can assert on it for a clear failure message.
export async function pollFor(fetchFn, pred, { ms = 8000, every = 300 } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try { last = await fetchFn(); if (pred(last)) return last; } catch {}
    await sleep(every);
  }
  return last;
}

// Rebuild a complete /config form body from an /info.json snapshot, applying overrides to
// one output (output B by default). Sending every field avoids clobbering other settings.
//
// EVERY boolean has to be listed. handleConfigPost() sets bools from checkbox *presence*, so a
// key this helper forgets is not "left alone", it is actively set to false. Forgetting `useeth`
// takes the device off Ethernet and strands it in its setup AP with no way back over the
// network. Ints/enums are only written when present, so leaving those out is safe.
// Keep the boolean list in sync with the BFIELD entries in src/config/config_schema.cpp;
// CFG_NOWEB ones (autoupd) are not part of the form and must NOT be sent.
export function configForm(snapshot, overrides = {}, outIdx = 1) {
  const f = {
    protocol: String(snapshot.protocol),
    hostname: snapshot.hostname,
    // Art-Net node names (issue #129). Not CFG_KEEPNE, so an empty string really clears them --
    // which is what makes this helper a faithful round-trip either way.
    artshort: snapshot.artShort || '',
    artlong: snapshot.artLong || '',
    otapw: snapshot.otapw,
    ledtype: String(snapshot.ledType),
    ledpin: String(snapshot.ledPin),
    ip: snapshot.sip || '',
    gateway: snapshot.gateway || '',
    subnet: snapshot.subnet || '',
    dns: snapshot.dns || '',
  };
  if (snapshot.staticIp)      f.staticip = '1';
  if (snapshot.useEthernet)   f.useeth   = '1';
  if (snapshot.ethW5500)      f.ethon    = '1';
  if (snapshot.artnetRdm)     f.artrdm   = '1';
  if (snapshot.ipProg)        f.ipprog   = '1';
  if (snapshot.encReverse)    f.encrev   = '1';
  if (snapshot.btnActiveHigh) f.btnah    = '1';
  const outs = snapshot.outputs.map((o, i) => (i === outIdx ? { ...o, ...overrides } : o));
  outs.forEach((o, i) => {
    if (o.en) f[`o${i}_en`] = '1';     // omitted key == disabled
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
  Object.assign(f, pixelFormFields(snapshot.pixels));
  return f;
}

// The p<i>_* half of a /config body. The pixel ports are not in /info.json (deliberately: it
// gets polled, and a strip's settings are not status) but they ARE in the same form, and
// handleConfigPost drives p<i>_en, p<i>_statid and p<i>_vserp from checkbox PRESENCE like
// every other bool. Leave them out and the save switches all five ports off -- and the usual
// "post the snapshot back" cleanup posts the same gap a second time, so nothing comes back.
// Build the snapshot with configSnapshot() and this fills itself in; pass a snapshot without
// `pixels` and it writes nothing, which is only safe on a device that has no pixel ports set up.
export function pixelFormFields(ports) {
  const f = {};
  (ports || []).forEach((p, i) => {
    if (p.en)       f[`p${i}_en`]     = '1';   // omitted key == disabled
    if (p.statusIdle) f[`p${i}_statid`] = '1';
    if (p.viewSerp) f[`p${i}_vserp`]  = '1';
    f[`p${i}_pin`]     = String(p.pin);
    f[`p${i}_count`]   = String(p.count);
    f[`p${i}_chip`]    = String(p.chip);
    f[`p${i}_order`]   = String(p.order);
    f[`p${i}_uni`]     = String(p.uni);
    f[`p${i}_start`]   = String(p.start);
    f[`p${i}_unimode`] = String(p.uniMode);
    f[`p${i}_latch`]   = String(p.latch);
    f[`p${i}_fpscap`]  = String(p.fpsCap);
    f[`p${i}_bright`]  = String(p.bright);
    f[`p${i}_gamma`]   = String(p.gamma);
    f[`p${i}_maxma`]   = String(p.maxMa);
    f[`p${i}_machan`]  = String(p.mAPerCh);
    f[`p${i}_quiesma`] = String(p.quiesMa);
    f[`p${i}_loss`]    = String(p.loss);
    f[`p${i}_vcols`]   = String(p.viewCols);
    f[`p${i}_vrows`]   = String(p.viewRows);
  });
  return f;
}

// The pixel ports, or [] on a device (or a firmware) that has none.
export async function pixelPorts(request) {
  try {
    const r = await request.get('/pixels.json');
    if (!r.ok()) return [];
    const j = await r.json();
    return Array.isArray(j.ports) ? j.ports : [];
  } catch { return []; }
}

// The snapshot a /config POST has to be built from: /info.json plus the pixel ports. Use this
// instead of info() anywhere the result is going to be turned into a form body.
export async function configSnapshot(request) {
  const d = await info(request);
  d.pixels = await pixelPorts(request);
  return d;
}

// Poll /info.json across a reboot until `pred(info)` holds on TWO consecutive
// reads. Requiring a stable streak (not a single hit) means we only return once
// the device is solidly back up, not mid-reboot, so the next test doesn't race a
// device that's still flapping (the main source of ECONNRESET / WS-not-up flakes).
export async function waitForState(request, pred, ms = 45000) {
  await sleep(2000); // let the reboot begin
  const deadline = Date.now() + ms;
  let streak = 0, last = null;
  while (Date.now() < deadline) {
    try {
      const d = await info(request);
      if (pred(d)) { last = d; if (++streak >= 2) return d; }
      else streak = 0;
    } catch { streak = 0; }   // mid-reboot: reset the streak
    await sleep(1500);
  }
  if (last) return last;
  throw new Error('device did not reach the expected state in time');
}

// Wait until the device is reachable + stable (two consecutive /info.json reads).
// Use in a beforeEach after reboot-heavy tests so a spec starts from a settled device.
export async function waitReady(request, ms = 45000) {
  return waitForState(request, () => true, ms);
}
