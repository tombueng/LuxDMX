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
  return f;
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
