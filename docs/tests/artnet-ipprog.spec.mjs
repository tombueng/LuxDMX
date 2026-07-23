// Art-Net remote IP programming (ArtIpProg 0xf800 / ArtIpProgReply 0xf900, issue #110). A controller
// reads or sets the node's IP / mask / gateway (or switches it to DHCP) over the network, so a unit
// with a bad address can be recovered without the BOOT button or a serial cable.
//
// Two things are asserted with no device write, so they run in the normal suite:
//   * ArtPollReply Status2 sets the web-config bit and reports the *real* DHCP/static state
//     (regression for the old hard-coded 0x0e, which lied about DHCP and left web-config clear).
//   * With the feature off (the default), an ArtIpProg gets NO reply at all, the spec's own opt-out.
//
// The rest mutates config and is gated behind LUXDMX_WRITE=1. It never renumbers the live interface:
// ArtIpProg only persists, taking effect on the next boot, so the device stays reachable throughout.
// The static IP it programs is the device's OWN current address, so even an unexpected reboot is safe.
// The DHCP-switch-and-actually-reboot case is deliberately left to the rig with the Pi witness.
import { test, expect } from '@playwright/test';
import { deviceHost, artPollPacket, artIpProgPacket, artNetRequestReply, readIp4 } from './lib/net.mjs';
import { info, pollFor } from './lib/device.mjs';

const OP_POLLREPLY    = 0x2100;
const OP_IPPROGREPLY  = 0xf900;
const WRITE = process.env.LUXDMX_WRITE === '1';

let host;
test.beforeAll(async () => { host = await deviceHost(); });

// Minimal-safe /config form: handleConfigPost writes a boolean from its presence (an omitted checkbox
// becomes FALSE), while ints / enums / strings are only touched when the field is actually present.
// So to change one flag without a reboot or collateral damage, send every currently-on checkbox (so
// none get cleared) and nothing else; every other setting keeps its stored value untouched. `flips`
// overrides individual form keys; a null value unchecks that box.
function ipprogForm(d, flips = {}) {
  const f = {};
  if (d.ethW5500)      f.ethon    = '1';   // preserve: W5500 module enabled
  if (d.useEthernet)   f.useeth   = '1';   // preserve: wired Ethernet (omitting this drops the device to AP!)
  if (d.staticIp)      f.staticip = '1';   // preserve: static IP
  if (d.ipProg)        f.ipprog   = '1';   // preserve: the feature under test
  if (d.artnetRdm)     f.artrdm   = '1';   // preserve: RDM over Art-Net
  if (d.encReverse)    f.encrev   = '1';
  if (d.btnActiveHigh) f.btnah    = '1';
  d.outputs.forEach((o, i) => { if (o.en) f[`o${i}_en`] = '1'; });  // output enables are checkboxes too
  for (const [k, v] of Object.entries(flips)) { if (v === null) delete f[k]; else f[k] = v; }
  return f;
}

// ── read-only (always run) ──────────────────────────────────────────────────

test('ArtPollReply Status2 sets the web-config bit and tracks the real DHCP state', async ({ request }) => {
  const d = await info(request);
  const reply = await artNetRequestReply(host, artPollPacket(), { wantOp: OP_POLLREPLY, timeoutMs: 3000 });
  expect(reply, 'device must answer ArtPoll').toBeTruthy();
  const status2 = reply[212];
  expect(status2 & 0x01, 'Status2 bit0 = web-browser config supported').toBe(0x01);
  // bit1 = "IP is DHCP configured": set on DHCP, clear on a static IP. Used to be hard-coded set.
  const dhcpBit = status2 & 0x02;
  if (d.staticIp) expect(dhcpBit, 'static IP -> DHCP bit clear').toBe(0);
  else            expect(dhcpBit, 'DHCP -> DHCP bit set').toBe(0x02);
});

test('ArtIpProg gets no reply when the feature is off (spec opt-out)', async ({ request }) => {
  const d = await info(request);
  test.skip(d.ipProg === true, 'ipProg is enabled on the device; the off-path is exercised by the mutating suite');
  const reply = await artNetRequestReply(host, artIpProgPacket(0x00), { wantOp: OP_IPPROGREPLY, timeoutMs: 1500 });
  expect(reply, 'a node with ArtIpProg off must not reply to ArtIpProg').toBeNull();
});

// ── mutating (LUXDMX_WRITE=1) ───────────────────────────────────────────────

test.describe('ArtIpProg enabled', () => {
  test.skip(!WRITE, 'set LUXDMX_WRITE=1 to run the config-mutating ArtIpProg tests');

  let snap;
  test.beforeAll(async ({ request }) => {
    snap = await info(request);
    // Turn the feature on. ipprog is a LIVE key, so this applies without a reboot; the minimal-safe
    // form keeps every other setting (Ethernet, RDM, ...) intact.
    await request.post('/config', { form: ipprogForm(snap, { ipprog: '1' }) });
    await pollFor(() => info(request), (x) => x.ipProg === true, { ms: 10000 });
  });

  test.afterAll(async ({ request }) => {
    // Restore the network config the way it shipped (DHCP, empty IP/gw, /24 mask) via an ArtIpProg
    // factory-default (reboot-free), then put the feature flag back where it started.
    await artNetRequestReply(host, artIpProgPacket(0x88), { wantOp: OP_IPPROGREPLY, timeoutMs: 1500 }); // enable | default
    const cur = await pollFor(() => info(request), (x) => x.staticIp === false && (x.sip || '') === '', { ms: 10000 });
    await request.post('/config', { form: ipprogForm(cur, { ipprog: snap.ipProg ? '1' : null }) });
    await pollFor(() => info(request), (x) => x.ipProg === (snap.ipProg === true), { ms: 10000 });
  });

  test('enquiry returns a well-formed 34-byte reply with the current IP/mask/gateway', async ({ request }) => {
    const d = await info(request);
    const reply = await artNetRequestReply(host, artIpProgPacket(0x00), { wantOp: OP_IPPROGREPLY, timeoutMs: 2000 });
    expect(reply, 'ipProg on -> enquiry gets a reply').toBeTruthy();
    expect(reply.length, 'ArtIpProgReply is 34 bytes').toBe(34);
    expect(reply.readUInt16LE(8), 'opcode = ArtIpProgReply').toBe(OP_IPPROGREPLY);
    expect(reply[11], 'ProtVer = 14').toBe(14);
    expect(readIp4(reply, 16), 'ProgIp = the device IP').toBe(d.ip);
    expect(readIp4(reply, 20), 'ProgSm = the current mask').toBe(d.subnet || '255.255.255.0');
    expect(reply[26] & 0x40, 'Status bit6 = DHCP state').toBe(d.staticIp ? 0 : 0x40);
    // an enquiry (Command bit7 clear) must not change anything
    const after = await info(request);
    expect(after.staticIp).toBe(d.staticIp);
    expect(after.sip).toBe(d.sip);
  });

  test('programming a static IP is stored, reads back, and flips the DHCP bit', async ({ request }) => {
    const before = await info(request);
    const ip = before.ip;                       // the device's OWN current IP -> safe even on a reboot
    const sm = before.subnet || '255.255.255.0';
    // Command = enable | program-IP | program-mask (0x86). An explicit IP means static mode.
    const reply = await artNetRequestReply(host, artIpProgPacket(0x86, { ip, sm }), { wantOp: OP_IPPROGREPLY, timeoutMs: 2000 });
    expect(reply, 'programming gets a confirming reply').toBeTruthy();
    expect(reply[26] & 0x40, 'reply already reports static (DHCP bit clear)').toBe(0);
    expect(readIp4(reply, 16), 'reply echoes the stored IP').toBe(ip);

    // Persisted (not applied to the live interface; the device is still reachable at `ip`).
    const stored = await pollFor(() => info(request), (x) => x.staticIp === true && x.sip === ip, { ms: 10000 });
    expect(stored.staticIp, 'programming an IP switched the node to static').toBe(true);
    expect(stored.sip, 'the programmed IP was stored').toBe(ip);

    // A fresh enquiry now reports static + the programmed IP.
    const enq = await artNetRequestReply(host, artIpProgPacket(0x00), { wantOp: OP_IPPROGREPLY, timeoutMs: 2000 });
    expect(enq[26] & 0x40, 'static now -> DHCP bit clear').toBe(0);
    expect(readIp4(enq, 16), 'enquiry reads back the programmed IP').toBe(ip);

    // ArtPollReply Status2 bit1 (same source of truth) has followed it to static.
    const poll = await artNetRequestReply(host, artPollPacket(), { wantOp: OP_POLLREPLY, timeoutMs: 3000 });
    expect(poll[212] & 0x02, 'Status2 DHCP bit clear while static').toBe(0);

    // Switch back to DHCP over the wire (Command = enable | DHCP) and confirm it took.
    await artNetRequestReply(host, artIpProgPacket(0xc0), { wantOp: OP_IPPROGREPLY, timeoutMs: 2000 });
    const dhcp = await pollFor(() => info(request), (x) => x.staticIp === false, { ms: 10000 });
    expect(dhcp.staticIp, 'DHCP command cleared static').toBe(false);
  });
});
