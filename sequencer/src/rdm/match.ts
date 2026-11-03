// The rig against the show: which real light (found with RDM) is which fixture in the patch, and
// what's wrong between them. Pure, so every case is tested (match.test.ts).
//
// A fixture that knows its light (`uid`, set when it was patched from the rig or matched once) is
// followed wherever the light's address goes; otherwise a light belongs to the fixture patched at
// its universe and address. What can be off:
//   address   the light listens somewhere else than its fixture is patched
//   mode      it uses another number of channels (another mode on the light or in the patch)
//   clash     two lights share channels
//   unpatched a light the show doesn't know
//   silent    a fixture in a universe that was scanned, with no light answering at its address (many
//             lights don't speak RDM at all: a hint, not an error)
import type { RdmDevice } from './types';

export interface PatchedFixture { id: string; name: string; universe: number; address: number; channels: number; uid?: string }
export type Problem = 'address' | 'mode' | 'clash' | 'unpatched';
export interface DeviceCheck { uid: string; fixture?: string; problems: Problem[]; clashWith: string[] }
export interface RigCheck {
  devices: DeviceCheck[];                         // in the order given
  silent: string[];                               // fixture ids
  ok: number;                                     // lights that match their fixture exactly
  issues: number;                                 // lights with a problem
}

const overlaps = (u1: number, a1: number, n1: number, u2: number, a2: number, n2: number) =>
  u1 === u2 && n1 > 0 && n2 > 0 && a1 <= a2 + n2 - 1 && a2 <= a1 + n1 - 1;

export function checkRig(devices: RdmDevice[], fixtures: PatchedFixture[], scanned: Set<number>): RigCheck {
  const byUid = new Map(fixtures.filter((f) => f.uid).map((f) => [f.uid!, f]));
  const taken = new Set<string>();
  const out: DeviceCheck[] = devices.map((d) => ({ uid: d.uid, problems: [], clashWith: [] }));
  // first the fixtures that know their light, then the ones at the light's address
  devices.forEach((d, i) => { const f = byUid.get(d.uid); if (f) { out[i].fixture = f.id; taken.add(f.id); } });
  devices.forEach((d, i) => {
    if (out[i].fixture) return;
    const f = fixtures.find((x) => !taken.has(x.id) && !x.uid && x.universe === d.uni && x.address === d.addr);
    if (f) { out[i].fixture = f.id; taken.add(f.id); }
  });
  const fx = new Map(fixtures.map((f) => [f.id, f]));
  devices.forEach((d, i) => {
    const c = out[i], f = c.fixture ? fx.get(c.fixture) : undefined;
    if (!f) c.problems.push('unpatched');
    else {
      if (f.universe !== d.uni || f.address !== d.addr) c.problems.push('address');
      if (d.footprint !== f.channels) c.problems.push('mode');
    }
    devices.forEach((e, j) => { if (j !== i && overlaps(d.uni, d.addr, d.footprint, e.uni, e.addr, e.footprint)) c.clashWith.push(e.uid); });
    if (c.clashWith.length) c.problems.push('clash');
  });
  const found = new Set(out.map((c) => c.fixture).filter(Boolean));
  const silent = fixtures.filter((f) => scanned.has(f.universe) && !found.has(f.id)).map((f) => f.id);
  return { devices: out, silent, ok: out.filter((c) => !c.problems.length).length, issues: out.filter((c) => c.problems.length).length };
}

// What to do about it. Each fix says which way it goes: to the light (RDM SET, the rig changes) or
// to the show (the patch changes). "Make the rig match the show" takes every fix towards the light.
export type Fix =
  | { to: 'light'; kind: 'address'; uid: string; addr: number; fixture: string }
  | { to: 'light'; kind: 'mode'; uid: string; mode: number; fixture: string }
  | { to: 'show'; kind: 'address'; fixture: string; universe: number; addr: number; uid: string }
  | { to: 'show'; kind: 'mode'; fixture: string; mode: string; uid: string }
  | { to: 'show'; kind: 'patch'; uid: string };

// the light's mode that has `channels` channels (when it said which it has)
export const modeWith = (d: RdmDevice, channels: number) => d.modeList?.find((m) => m.footprint === channels)?.n;

export function fixesFor(d: RdmDevice, c: DeviceCheck, fixtures: PatchedFixture[], typeModes?: (fixtureId: string) => { name: string; channels: number }[]): Fix[] {
  const f = c.fixture ? fixtures.find((x) => x.id === c.fixture) : undefined;
  if (!f) return [{ to: 'show', kind: 'patch', uid: d.uid }];
  const fixes: Fix[] = [];
  if (c.problems.includes('address')) {
    // (a light can only be set within its own line's universe)
    if (f.universe === d.uni) fixes.push({ to: 'light', kind: 'address', uid: d.uid, addr: f.address, fixture: f.id });
    fixes.push({ to: 'show', kind: 'address', fixture: f.id, universe: d.uni, addr: d.addr, uid: d.uid });
  }
  if (c.problems.includes('mode')) {
    const m = modeWith(d, f.channels);
    if (m) fixes.push({ to: 'light', kind: 'mode', uid: d.uid, mode: m, fixture: f.id });
    const other = typeModes?.(f.id).find((x) => x.channels === d.footprint);
    if (other) fixes.push({ to: 'show', kind: 'mode', fixture: f.id, mode: other.name, uid: d.uid });
  }
  return fixes;
}

// The first free run of `n` channels in a universe from `from` on (0: none), given what's taken.
export function freeRun(taken: { address: number; channels: number }[], n: number, from = 1): number {
  for (let a = Math.max(1, from); a + n - 1 <= 512; a++) {
    const hit = taken.find((t) => a <= t.address + t.channels - 1 && t.address <= a + n - 1);
    if (!hit) return a;
    a = hit.address + hit.channels - 1;
  }
  return 0;
}

// ---- which fixture profile a light is: by its RDM maker and model ids where the library has them,
// else by its maker's and model's names, with a mode of its channel count (or its RDM personality)
export interface LibEntry { source: 'ofl' | 'qlc'; key: string; name: string; manufacturer: string; modes?: [string, number, number?][]; rdm?: [number, number] }
export interface Guess { entry: LibEntry; mode?: string; sure: boolean }
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const squash = (s: string) => norm(s).replace(/ /g, '');

export function guessProfile(d: RdmDevice, lib: LibEntry[]): Guess | undefined {
  const maker = parseInt(d.uid.slice(0, 4), 16);
  const modeOf = (e: LibEntry) => e.modes?.find((m) => m[2] === d.mode && m[1] === d.footprint)?.[0] ?? e.modes?.find((m) => m[1] === d.footprint)?.[0];
  const byId = lib.find((e) => e.rdm && e.rdm[0] === maker && e.rdm[1] === d.modelId);
  if (byId) return { entry: byId, mode: modeOf(byId), sure: true };
  if (!d.model && !d.maker) return undefined;
  const mk = squash(d.maker), model = norm(d.model), modelSq = squash(d.model);
  let best: { e: LibEntry; score: number } | undefined;
  for (const e of lib) {
    const em = squash(e.manufacturer);
    if (mk && !(em.includes(mk) || mk.includes(em))) continue;
    const name = norm(e.name), sq = squash(e.name);
    if (!sq) continue;
    // every word of the library's name in the light's model description (or the same letters run together)
    const words = name.split(' ');
    if (!(modelSq.includes(sq) || words.every((w) => model.split(' ').includes(w)))) continue;
    let score = sq.length * 2 - Math.abs(modelSq.length - sq.length);
    if (modeOf(e)) score += 20;
    if (e.source === 'ofl') score += 1;
    if (!best || score > best.score) best = { e, score };
  }
  return best ? { entry: best.e, mode: modeOf(best.e), sure: false } : undefined;
}
