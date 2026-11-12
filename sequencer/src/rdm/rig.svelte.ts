// The real rig, found with RDM on every box the show talks to (LuxDMX boxes through their bridge
// page, Art-Net nodes through LuxDMX Link): scan, check against the patch, fix either way, and watch
// it while the show runs (lights going away and coming back, status messages, sensors, a history of
// their readings). The screen is ui/RigCheck.svelte.
import { app } from '../app.svelte';
import { Bridge } from '../output/bridge';
import { LinkOutput } from '../output/link';
import { fromBox } from './box';
import { checkRig, fixesFor, guessProfile, type Fix, type LibEntry, type PatchedFixture, type RigCheck } from './match';
import { STATUS_LEVEL, type RdmDevice, type RdmReply, type RdmSource } from './types';
import { fetchType, loadCatalog } from '../library/catalog';
import type { Channel, FixtureType } from '../model/types';

export interface RigEvent { at: number; kind: 'found' | 'gone' | 'back' | 'status' | 'hot' | 'set' | 'error'; uid?: string; text: string }
const HISTORY = 720;            // sensor readings kept per light (an hour at the watching rate)
const WATCH_MS = 5000;

class Rig {
  sources = $state<RdmSource[]>([]);
  events = $state<RigEvent[]>([]);
  watching = $state(false);
  scanning = $state(false);
  // readings over time: uid -> sensor name -> [ms, value][]
  history = new Map<string, Map<string, [number, number][]>>();
  historyRev = $state(0);
  private known = new Map<string, { gone: boolean; status: number; hot: boolean }>();
  private knownRev = $state(0);           // (the screen reads `known` through this)
  private timer: ReturnType<typeof setInterval> | undefined;

  // every light found, on every box
  get devices(): RdmDevice[] { return this.sources.flatMap((s) => s.devices); }
  device(uid: string) { return this.devices.find((d) => d.uid === uid); }
  // the universes that were scanned (a fixture there that doesn't answer is "silent")
  get scanned(): Set<number> { return new Set(this.sources.filter((s) => s.scan.stage === 'done').flatMap((s) => [...s.lines.map((l) => l.uni), ...s.devices.map((d) => d.uni)])); }
  get patched(): PatchedFixture[] {
    return app.show.fixtures.map((f) => ({ id: f.id, name: f.name, universe: f.universe, address: f.address, channels: app.modeOf(f.id)?.channels.length ?? 1, ...(f.uid ? { uid: f.uid } : {}) }));
  }
  get check(): RigCheck { return checkRig(this.devices, this.patched, this.scanned); }
  fixes(uid: string): Fix[] {
    const d = this.device(uid), c = this.check.devices.find((x) => x.uid === uid);
    if (!d || !c || !c.problems.length) return [];
    return fixesFor(d, c, this.patched, (id) => {
      const f = app.show.fixtures.find((x) => x.id === id), t = f && app.types.get(f.typeId);
      return t ? t.modes.map((m) => ({ name: m.name, channels: m.channels.length })) : [];
    });
  }

  // ---- the boxes
  private ports(): Bridge[] { return app.bridges.filter((b) => b.state === 'ready'); }
  private source(b: Bridge): RdmSource {
    let s = this.sources.find((x) => x.key === b.host);
    if (!s) {
      s = { key: b.host, name: b.name || b.host, can: 'unknown', scan: { busy: false, found: 0, stage: 'idle' }, lines: [], devices: [], at: 0 };
      this.sources = [...this.sources, s];
      s = this.sources.find((x) => x.key === b.host)!;
    }
    return s;
  }
  private why(b: Bridge, r: RdmReply): string {
    if (b instanceof LinkOutput) return r.error === 'timeout' ? `LuxDMX Link ${b.version || ''} can't do RDM yet: an update brings it (Art-Net RDM)`.replace('  ', ' ') : 'LuxDMX Link isn\'t answering';
    if (r.error === 'timeout') return 'This box\'s firmware has no RDM for the sequencer yet: an update brings it';
    if (r.status === 404) return 'This box\'s firmware has no RDM';
    return 'The box didn\'t answer';
  }
  private take(b: Bridge, r: RdmReply) {
    const s = this.source(b);
    s.name = b.name || b.host;
    if (!r.ok || !r.data) { s.can = r.error === 'timeout' || r.status === 404 ? 'no' : s.can; s.why = this.why(b, r); return false; }
    const got = fromBox(b.host, r.data);
    s.can = got.available ? 'yes' : 'no';
    s.why = got.available ? undefined : 'RDM is off on this box (its RDM page switches it on)';
    s.scan = got.scan; s.lines = got.lines; s.devices = got.devices; s.at = Date.now();
    this.notice(got.devices, s);
    return true;
  }
  // read every box's list once
  async refresh() {
    await Promise.all(this.ports().map(async (b) => this.take(b, await b.rdm({ op: 'list' }))));
    this.sample();
  }
  // search every line of every box for lights (a few seconds: the box searches, then reads each
  // light's details), the list filling in as they're found
  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const boxes = this.ports();
      if (!boxes.length) { this.log({ kind: 'error', text: 'No box is connected: connect one, then scan' }); return; }
      await Promise.all(boxes.map(async (b) => {
        const r = await b.rdm({ op: 'scan' });
        if (!r.ok) { this.take(b, r); return; }
        const s = this.source(b);
        s.scan = { busy: true, found: 0, stage: 'search' };
        const until = Date.now() + 90_000;
        await new Promise((res) => setTimeout(res, 300));
        while (Date.now() < until) {
          const l = await b.rdm({ op: 'list' });
          if (!this.take(b, l)) break;
          if (!this.source(b).scan.busy) break;
          await new Promise((res) => setTimeout(res, 400));
        }
      }));
      this.sample();
    } finally { this.scanning = false; }
  }

  // ---- watching: a calm read of every box every few seconds while it's on
  watch(on: boolean) {
    this.watching = on;
    clearInterval(this.timer);
    if (on) { void this.refresh(); this.timer = setInterval(() => { if (!this.scanning) void this.refresh(); }, WATCH_MS); }
  }
  private sample() {
    const t = Date.now();
    for (const d of this.devices) for (const s of d.sensors) {
      let m = this.history.get(d.uid);
      if (!m) this.history.set(d.uid, (m = new Map()));
      const h = m.get(s.name) ?? [];
      if (!h.length || t - h[h.length - 1][0] > 1000) { h.push([t, s.value]); if (h.length > HISTORY) h.splice(0, h.length - HISTORY); }
      m.set(s.name, h);
    }
    this.historyRev++;
  }
  // what changed since the last read: a light new, gone (missing from a box that answered), back,
  // a new status message, a sensor at the top of its range
  private notice(now: RdmDevice[], s: RdmSource) {
    const here = new Set(now.map((d) => d.uid));
    for (const d of now) {
      const k = this.known.get(d.uid), name = d.label || d.model || d.uid;
      const level = STATUS_LEVEL(d.status.type);
      const hot = d.sensors.some((x) => x.unit.toUpperCase().startsWith('C') && x.value >= 65);
      if (!k) this.log({ kind: 'found', uid: d.uid, text: `Found ${name} (${d.maker || 'unknown maker'}) at ${d.uni}.${d.addr}` });
      else if (k.gone) this.log({ kind: 'back', uid: d.uid, text: `${name} answers again` });
      if (level !== 'ok' && d.status.type !== k?.status) this.log({ kind: 'status', uid: d.uid, text: `${name} reports a${level === 'error' ? 'n error' : level === 'warning' ? ' warning' : 'n advisory'} (message ${d.status.id})` });
      if (hot && !k?.hot) this.log({ kind: 'hot', uid: d.uid, text: `${name} is running hot (${d.sensors.map((x) => `${x.value} ${x.unit}`).join(', ')})` });
      this.known.set(d.uid, { gone: false, status: d.status.type, hot });
    }
    // gone: it was on this box and a finished scan or a read doesn't have it any more
    if (s.scan.stage !== 'search' && s.scan.stage !== 'details')
      for (const [uid, k] of this.known) if (!k.gone && !here.has(uid) && this.lastVia.get(uid) === s.key) { k.gone = true; this.log({ kind: 'gone', uid, text: `${this.names.get(uid) ?? uid} stopped answering` }); }
    for (const d of now) { this.lastVia.set(d.uid, s.key); this.names.set(d.uid, d.label || d.model || d.uid); }
    this.knownRev++;
  }
  private lastVia = new Map<string, string>();
  private names = new Map<string, string>();
  gone(uid: string) { void this.knownRev; return !!this.known.get(uid)?.gone; }
  get goneList(): { uid: string; name: string }[] { void this.knownRev; return [...this.known].filter(([, k]) => k.gone).map(([uid]) => ({ uid, name: this.names.get(uid) ?? uid })); }
  private log(e: Omit<RigEvent, 'at'>) { this.events = [{ at: Date.now(), ...e }, ...this.events].slice(0, 300); }

  // ---- doing things to a light (each read back from the box after)
  private boxOf(uid: string) { const d = this.device(uid); return d ? app.bridges.find((b) => b.host === d.via && b.state === 'ready') : undefined; }
  private async set(uid: string, req: Parameters<Bridge['rdm']>[0], what: string) {
    const b = this.boxOf(uid);
    if (!b) { this.log({ kind: 'error', uid, text: `${what}: its box isn't connected` }); return false; }
    const r = await b.rdm(req);
    if (!r.ok) { this.log({ kind: 'error', uid, text: `${what}: ${r.status === 400 || r.status === 404 ? 'the box can\'t do that (an update brings it)' : 'no answer'}` }); return false; }
    this.log({ kind: 'set', uid, text: what });
    await new Promise((res) => setTimeout(res, 150));
    this.take(b, await b.rdm({ op: 'list' }));
    return true;
  }
  identify(uid: string, on: boolean) { const d = this.device(uid); return this.set(uid, { op: 'identify', uid, on }, `${on ? 'Identify on' : 'Identify off'}: ${d?.label || d?.model || uid}`); }
  setAddress(uid: string, addr: number) { return this.set(uid, { op: 'address', uid, addr }, `Set ${this.names.get(uid) ?? uid} to address ${addr}`); }
  setMode(uid: string, mode: number) { const d = this.device(uid); return this.set(uid, { op: 'mode', uid, mode }, `Set ${this.names.get(uid) ?? uid} to ${d?.modeList?.find((m) => m.n === mode)?.name ?? `mode ${mode}`}`); }
  setLabel(uid: string, label: string) { return this.set(uid, { op: 'label', uid, label }, `Named ${uid} "${label}"`); }

  // a fix, either way (to the light: RDM; to the show: the patch, one undo step)
  async apply(f: Fix) {
    if (f.to === 'light') return f.kind === 'address' ? this.setAddress(f.uid, f.addr) : this.setMode(f.uid, f.mode);
    if (f.kind === 'patch') return this.patch([f.uid]).then((n) => n > 0);
    const fx = app.show.fixtures.find((x) => x.id === f.fixture);
    if (!fx) return false;
    app.checkpoint();
    if (f.kind === 'address') { fx.universe = f.universe; fx.address = f.addr; } else fx.mode = f.mode;
    fx.uid = f.uid;
    app.markDirty(0);
    this.log({ kind: 'set', uid: f.uid, text: f.kind === 'address' ? `Moved ${fx.name} in the patch to ${f.universe}.${f.addr}` : `${fx.name} now in ${f.mode} in the patch` });
    return true;
  }
  // the rig made to match the show: every fix towards the lights, one after the other
  plan(): Fix[] { return this.check.devices.flatMap((c) => this.fixes(c.uid).filter((f) => f.to === 'light').filter((f, i, a) => a.findIndex((x) => x.kind === f.kind) === i)); }
  async matchShow() { let n = 0; for (const f of this.plan()) if (await this.apply(f)) n++; return n; }
  // a fixture that matches its light at its address learns which light it is
  link(uid: string, fixture: string) { const f = app.show.fixtures.find((x) => x.id === fixture); if (f && f.uid !== uid) { app.checkpoint(); f.uid = uid; app.markDirty(0); } }

  // ---- the show from the rig: lights the show doesn't know, patched where they are, with their own
  // profile when the fixture library knows them (by RDM ids, else by name), else a plain one with
  // their number of channels; named after their label
  async patch(uids: string[]): Promise<number> {
    let lib: LibEntry[] = [];
    try { lib = (await loadCatalog()) as LibEntry[]; } catch { /* plain types then */ }
    let n = 0;
    for (const uid of uids) {
      const d = this.device(uid);
      if (!d || app.show.fixtures.some((f) => f.uid === uid)) continue;
      // a type of the show's own or one of yours with its RDM ids first (an imported GDTF, a plain
      // one you've since told what its channels do), then the library, then a plain one
      const own = ownType(d);
      const g = own ? undefined : guessProfile(d, lib);
      let typeId = own?.typeId ?? '', mode = own?.mode ?? '';
      if (g) {
        try { const t = await fetchType(g.entry as Parameters<typeof fetchType>[0]); const m = t.modes.find((x) => x.name === g.mode) ?? t.modes.find((x) => x.channels.length === d.footprint); if (m) { typeId = app.addType(t); mode = m.name; } } catch { /* plain then */ }
      }
      if (!typeId) { const t = plainType(d); typeId = app.addType(t); mode = t.modes[0].name; }
      const before = app.show.fixtures.length;
      const err = app.addFixtures(typeId, mode, 1, d.uni, d.label || d.model || 'Light', d.addr);
      if (err || app.show.fixtures.length === before) { this.log({ kind: 'error', uid, text: `Couldn't patch ${d.label || d.model}: ${err}` }); continue; }
      const f = app.show.fixtures[app.show.fixtures.length - 1];
      f.uid = uid;
      n++;
      this.log({ kind: 'set', uid, text: `Patched ${f.name} at ${d.uni}.${d.addr}${own ? ` as ${own.name}` : g ? ` as ${g.entry.manufacturer} ${g.entry.name}${g.sure ? '' : ' (by its name)'}` : ' (a plain profile)'}` });
    }
    if (n) app.markDirty(0);
    return n;
  }
}

// A type the show (or this browser, "My fixtures") already has for a light, by its RDM maker and
// model ids: the mode its personality is, else one with as many channels as it uses.
export function ownType(d: RdmDevice): { typeId: string; mode: string; name: string } | undefined {
  const maker = parseInt(d.uid.slice(0, 4), 16);
  // (the show's own first, the latest of them first: one you changed is a copy made after the
  // plain one; then yours from other shows)
  const all = [...[...app.show.fixtureTypes].reverse(), ...app.myTypes.filter((t) => !app.show.fixtureTypes.some((x) => x.id === t.id))];
  for (const t of all) {
    if (t.rdm?.maker !== maker || t.rdm.model !== d.modelId) continue;
    const named = t.rdm.modes?.[String(d.mode)];
    const m = t.modes.find((x) => x.name === named && x.channels.length === d.footprint) ?? t.modes.find((x) => x.channels.length === d.footprint);
    if (!m) continue;
    const typeId = app.show.fixtureTypes.some((x) => x.id === t.id) ? t.id : app.addType(t);
    return { typeId, mode: m.name, name: `${t.manufacturer} ${t.model}`.trim() };
  }
  return undefined;
}
// a light the library doesn't know: its channels, plain (named "Channel 1" and on), its own maker
// and model, so the next one of these is the same type
// E1.20 product category: pyrotechnics (an atmospheric effect that fires)
const PYRO = 0x0402;
export function plainType(d: RdmDevice): FixtureType {
  // (a pyro device whose channels nobody knows yet: every one of them waits for Arm and is cut off
  // after the shortest time a machine may fire, until its channels are told apart in the editor)
  const pyro = d.category === PYRO;
  const channels: Channel[] = Array.from({ length: Math.max(1, d.footprint) }, (_, i) => (pyro ? { name: `Pyro ${i + 1}`, attr: 'flame' } : { name: `Channel ${i + 1}`, attr: 'raw' }));
  const model = d.model || `Model ${d.modelId.toString(16).toUpperCase()}`, mode = d.modeList?.find((m) => m.n === d.mode)?.name ?? `${d.footprint} channel`;
  return { id: `rdm-${d.uid.slice(0, 4)}-${d.modelId.toString(16)}`, manufacturer: d.maker || `Maker ${d.uid.slice(0, 4)}`, model, source: 'user', modes: [{ name: mode, channels }],
    rdm: { maker: parseInt(d.uid.slice(0, 4), 16), model: d.modelId, modes: { [String(d.mode)]: mode } } };
}

export const rig = new Rig();
