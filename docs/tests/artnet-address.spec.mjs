// Full ArtAddress remote configuration (OpCode 0x6000, issue #129). This is how a console's own
// network window (ChamSys MagicQ Network Manager, DMX-Workshop, OLA) renames the node and moves an
// output to another universe, without leaving the console.
//
// Read-only assertions run in the normal suite:
//   * ArtPollReply serves the configured names, falling back to the hostname rather than the old
//     hard-coded "LuxDMX" that made every box on a rig look identical in a node list.
//   * One reply per enabled output, each with its own BindIndex, and the Net/Sub/SwOut split in it
//     recomposes to exactly that output's universe in /info.json.
//   * An ArtAddress that programs nothing (no name, no bit-7 address bytes) changes nothing. That is
//     the regression that matters most here: without the bit-7 check, a console flipping the merge
//     mode would silently drag every port to universe 0.
//
// The rest mutates config and gates behind LUXDMX_WRITE=1: program the names and output A's
// universe over the wire, read both back from /info.json and from the reply, prove they survive a
// reboot, then restore. afterAll re-POSTs the whole /config form rebuilt from the opening snapshot,
// so a run leaves the device exactly as it found it.
import { test, expect } from '@playwright/test';
import { deviceHost, sleep, e131Packet, streamFor, prepInput, UdpSender, SACN_PORT } from './lib/net.mjs';
import { ArtRdmClient, uniParts, AC_CANCEL_MERGE } from './lib/artrdm.mjs';
import { info, dmx, configForm, pollFor, waitForState } from './lib/device.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
const AC_NONE = 0x00;   // "no command"; the packet is only carrying fields

let host, c;
test.beforeAll(async () => { host = await deviceHost(); c = new ArtRdmClient(host); await c.ready; });
test.afterAll(async () => { await c?.close(); });

// ── read-only (always run) ──────────────────────────────────────────────────

test('ArtPollReply advertises a name that identifies THIS box, not the product', async ({ request }) => {
  const d = await info(request);
  const r = await c.poll();
  expect(r, 'no ArtPollReply received').toBeTruthy();
  const wantShort = (d.artShort || d.hostname || 'LuxDMX').slice(0, 17);
  const wantLong  = d.artLong || d.hostname || 'LuxDMX Art-Net / sACN DMX gateway';
  expect(r.short, 'ShortName comes from artshort, else the hostname').toBe(wantShort);
  expect(r.long,  'LongName comes from artlong, else the hostname').toBe(wantLong.slice(0, 63));
  // The bug this feature fixes: two LuxDMX nodes were indistinguishable in a console's node list.
  if (!d.artShort) expect(r.short, 'unset name must fall back to the hostname').toBe(d.hostname.slice(0, 17));
});

test('every enabled output gets its own reply, and its port-address is the universe', async ({ request }) => {
  const d = await info(request);
  const enabled = d.outputs.map((o, i) => ({ ...o, i })).filter((o) => o.en);
  const replies = await c.pollAll();
  expect(replies.length, 'one ArtPollReply per enabled output').toBe(enabled.length);
  replies.forEach((r, n) => {
    expect(r.bindIndex, 'BindIndex is 1-based and in port order').toBe(n + 1);
    // NetSwitch (bits 8..14) + SubSwitch (4..7) + SwOut (0..3) must recompose to the universe.
    expect(r.universe, `bind ${r.bindIndex} carries output ${enabled[n].i}'s universe`).toBe(enabled[n].uni);
    expect(r.netSwitch).toBe((enabled[n].uni >> 8) & 0x7f);
    expect(r.subSwitch).toBe((enabled[n].uni >> 4) & 0x0f);
  });
});

test('an ArtAddress that programs nothing leaves the universe and the names alone', async ({ request }) => {
  const before = await info(request);
  // No name bytes, and NetSwitch / SubSwitch / SwOut all left at 0 -> bit 7 clear -> "unchanged".
  // AcCancelMerge is a real command, so this is exactly the shape of an unrelated port-config
  // packet: before the bit-7 rule was implemented, this dragged the port to universe 0.
  const replies = await c.addressAll(1, AC_CANCEL_MERGE);
  expect(replies.length, 'ArtAddress must be answered with ArtPollReply(s)').toBeGreaterThan(0);
  const after = await info(request);
  expect(after.outputs.map((o) => o.uni), 'no universe moved').toEqual(before.outputs.map((o) => o.uni));
  expect(after.artShort, 'empty ShortName field is not "set to empty"').toBe(before.artShort);
  expect(after.artLong,  'empty LongName field is not "set to empty"').toBe(before.artLong);
});

// ── mutating (LUXDMX_WRITE=1) ───────────────────────────────────────────────

test.describe('ArtAddress programming', () => {
  test.skip(!WRITE, 'set LUXDMX_WRITE=1 to run the config-mutating ArtAddress tests');

  let snap;
  test.beforeAll(async ({ request }) => { snap = await info(request); });

  // Put everything back exactly as it was. One POST of the complete /config form rebuilt from the
  // opening snapshot restores the names AND every output's universe, and leaves the rest untouched.
  test.afterAll(async ({ request }) => {
    await request.post('/config', { form: configForm(snap, {}, 1) });
    await pollFor(() => info(request),
      (x) => (x.artShort || '') === (snap.artShort || '') &&
             x.outputs.every((o, i) => o.uni === snap.outputs[i].uni), { ms: 15000 });
  });

  test('a console renames the node, and the next poll says so', async ({ request }) => {
    const short = 'Stage Left', long = 'LuxDMX on the stage-left truss';
    const replies = await c.addressAll(1, AC_NONE, { short, long });
    expect(replies.length, 'the rename is confirmed with an ArtPollReply').toBeGreaterThan(0);
    expect(replies[0].short, 'the confirming reply already carries the new name').toBe(short);
    expect(replies[0].long).toBe(long);

    const d = await pollFor(() => info(request), (x) => x.artShort === short, { ms: 10000 });
    expect(d.artShort, 'stored under artshort, not the hostname').toBe(short);
    expect(d.artLong).toBe(long);
    expect(d.hostname, 'the hostname (mDNS / DHCP name) must NOT be touched').toBe(snap.hostname);

    // A separate poll (a console re-discovering the node) sees it too.
    const again = await c.poll();
    expect(again.short).toBe(short);
  });

  test('a name field left empty does not blank the name that is already set', async ({ request }) => {
    const before = await info(request);
    expect(before.artShort, 'the rename test runs first and leaves a name set').toBeTruthy();
    // Program ONLY the universe fields. The name bytes stay zeroed.
    await c.addressAll(1, AC_NONE, uniParts(before.outputs[0].uni));
    await sleep(400);
    const after = await info(request);
    expect(after.artShort, 'a universe-only ArtAddress must not wipe the label').toBe(before.artShort);
    expect(after.artLong).toBe(before.artLong);
  });

  test('a console moves an output to another universe, live, and it sticks', async ({ request }) => {
    const before = await info(request);
    const cur = before.outputs[0].uni;
    // Somewhere that exercises all three fields (Net, Sub and SwOut) and is not where we are now.
    const target = cur === 0x125 ? 0x236 : 0x125;
    const p = uniParts(target);

    const replies = await c.addressAll(1, AC_NONE, p);
    expect(replies.length, 'the change is confirmed with an ArtPollReply').toBeGreaterThan(0);
    expect(replies[0].universe, 'the confirming reply reads back the new port-address').toBe(target);
    expect(replies[0].netSwitch).toBe(p.net);
    expect(replies[0].subSwitch).toBe(p.sub);

    // Applied live (uni is a CFG_LIVE key) and persisted; no reboot anywhere in here.
    const d = await pollFor(() => info(request), (x) => x.outputs[0].uni === target, { ms: 10000 });
    expect(d.outputs[0].uni, 'the programmed universe reached /info.json').toBe(target);

    // Only the addressed port moved: SwOut[1..3] belong to ports this node does not have.
    expect(d.outputs[1].uni, 'the other output kept its universe').toBe(before.outputs[1].uni);

    // ...and it survives a power cycle, which is the half of the request that NVS has to carry.
    await request.post('/reboot');
    const back = await waitForState(request, (x) => x.outputs[0].uni === target, 60000);
    expect(back.outputs[0].uni, 'the universe survived the reboot').toBe(target);
    expect(back.artShort, 'so did the node name').toBe(before.artShort);
  });

  test('the universe programmed over the wire is the one the node actually listens on', async ({ request }) => {
    const d = await info(request);
    const uni = d.outputs[0].uni;
    // ArtPollReply is the console's read-back, so it has to agree with the running config.
    const r = await c.poll();
    expect(r.universe, 'ArtPollReply and /info.json agree after a remote change').toBe(uni);

    // And the input side follows: sACN on the NEW universe (Art-Net universe + 1) drives the output.
    // Sent unicast, like the whole suite does -- see the note in docs/tests/README.md. That means
    // this proves the routing followed the change, NOT that the multicast group was re-joined:
    // multicast does not reach the DUT across this bench, so the beginMulticast() call the rejoin
    // flag triggers is only observable on the device's serial log ("[sACN] out0 universe ...").
    await prepInput(host);
    const sender = new UdpSender(host);
    const data = Buffer.alloc(512, 0); data[0] = 173; data[1] = 42;
    try {
      await streamFor(sender, SACN_PORT, (seq) => e131Packet(uni + 1, data, seq), { ms: 1200, hz: 40 });
    } finally { sender.close(); }
    const got = await pollFor(() => dmx(request), (x) => x.ch[0] === 173, { ms: 5000 });
    expect(got.ch[0], `sACN universe ${uni + 1} reaches the remotely programmed output`).toBe(173);
    expect(got.ch[1]).toBe(42);
  });
});
