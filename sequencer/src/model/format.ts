// Reading and writing show files. FORMAT.md explains the rules; in short:
//   - `formatVersion` is semver. A reader opens any file whose `minReaderVersion` it satisfies.
//   - A file listing a `requiredFeatures` entry the reader doesn't know is refused, everything
//     else unknown is kept and written back as it was (we never rebuild objects field by field).
//   - Older files are brought up to date by one migration step per version, in order.
import type { Show } from './types';
import { isObj, mendShow } from './mend';
export { mendPastedCue } from './mend';

export const FORMAT = 'luxdmx-show';
export const FORMAT_VERSION = '1.2.0';
export const MIN_READER = '1.0.0';
// 'cells': cues, presets, groups or effects with single cells of pixel lights (a reader that
// doesn't know them would play those looks wrong: it must refuse the file)
export const KNOWN_FEATURES: string[] = ['cells'];
export const APP = 'LuxDMX Sequencer 0.2';

export function semverCmp(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0), pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  return 0;
}

export function emptyShow(name = 'New show'): Show {
  const now = new Date().toISOString();
  return {
    format: FORMAT, formatVersion: FORMAT_VERSION, minReaderVersion: MIN_READER, requiredFeatures: [],
    meta: { name, created: now, modified: now, app: APP },
    fixtureTypes: [], fixtures: [], groups: [], presets: [], cueLists: [], effects: [], pages: [],
    outputs: { devices: [] }, settings: { bpm: 120 }, extensions: {},
  };
}

export class FormatError extends Error {}

// Migrations from each version to the next. Each takes the file as parsed JSON and returns it one
// version newer. Add one entry per format change; never edit an old one.
const MIGRATIONS: { from: string; to: string; run: (s: any) => any }[] = [
  // 1.1.0 specified effects and pages; 1.0.0 files had none in use, nothing to change.
  { from: '1.0.0', to: '1.1.0', run: (s) => s },
  // 1.2.0 added cells, fixture numbers, console MIDI, RDM ids and new attributes: all new fields.
  { from: '1.1.0', to: '1.2.0', run: (s) => s },
];

// `notes`, when given, collects what had to be mended to open the file, in plain words (see mend).
export function parseShow(text: string, notes?: string[]): Show {
  let raw: any;
  try { raw = JSON.parse(text); } catch { throw new FormatError('not a show file (not JSON)'); }
  return upgrade(raw, notes);
}

export function upgrade(raw: any, notes: string[] = []): Show {
  if (!isObj(raw)) throw new FormatError('not a show file');
  // (keys that would set an object's prototype later: "__proto__": {"flame": 1} hides a flame
  // from every risk mark while the engine still reads it. Gone, said.)
  const bad = stripProtoKeys(raw);
  if (bad) notes.push(`${bad} key${bad > 1 ? 's' : ''} named like JavaScript internals (__proto__) left out`);
  if (raw.format !== FORMAT) {
    if (raw.version === 1 && Array.isArray(raw.fixtures) && Array.isArray(raw.cues)) raw = fromDev(raw);
    else throw new FormatError('not a LuxDMX show file');
  }
  const ver = (v: unknown) => (typeof v === 'string' ? v : '1.0.0');
  if (semverCmp(ver(raw.minReaderVersion), FORMAT_VERSION) > 0)
    throw new FormatError(`made with a newer version (needs format ${raw.minReaderVersion}, this app reads ${FORMAT_VERSION})`);
  if (!Array.isArray(raw.requiredFeatures)) raw.requiredFeatures = [];
  const unknown = raw.requiredFeatures.filter((f: unknown) => !KNOWN_FEATURES.includes(f as string));
  if (unknown.length) throw new FormatError(`needs features this version doesn't have: ${unknown.join(', ')}`);
  for (const m of MIGRATIONS) if (semverCmp(ver(raw.formatVersion), m.from) === 0) { raw = m.run(raw); raw.formatVersion = m.to; }
  return mendShow(raw, notes, emptyShow());
}

// own keys "__proto__" anywhere in a parsed file, taken out (how many): the one name an assignment
// turns into a prototype ("constructor" and "prototype" are plain keys, an extension may use them)
const PROTO_KEYS = ['__proto__'];
function stripProtoKeys(root: unknown): number {
  let n = 0;
  const stack: unknown[] = [root];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== 'object') continue;
    for (const k of PROTO_KEYS) if (Object.prototype.hasOwnProperty.call(o, k)) { delete (o as Record<string, unknown>)[k]; n++; }
    for (const v of Object.values(o as Record<string, unknown>)) if (v && typeof v === 'object') stack.push(v);
  }
  return n;
}

// Pretty for files people may open; compact (pretty: false) for the browser's storage.
export function serializeShow(show: Show, pretty = true): string {
  show.format = FORMAT;
  // (a newer file this version opened keeps its own numbers: a later app mustn't redo its upgrades)
  if (!show.formatVersion || semverCmp(show.formatVersion, FORMAT_VERSION) < 0) show.formatVersion = FORMAT_VERSION;
  if (!show.minReaderVersion || semverCmp(show.minReaderVersion, MIN_READER) < 0) show.minReaderVersion = MIN_READER;
  // what a reader must know to play it: cells, when the show has any (others it brought, kept)
  const req = new Set((show.requiredFeatures ?? []).filter((f) => f !== 'cells'));
  if (usesCells(show)) req.add('cells');
  show.requiredFeatures = [...req];
  show.meta.modified = new Date().toISOString();
  show.meta.app = APP;
  return JSON.stringify(show, null, pretty ? 2 : undefined);
}

// single cells anywhere that changes how the show plays
export function usesCells(s: Show): boolean {
  const has = (v: { cells?: unknown } | undefined) => !!v?.cells && Object.keys(v.cells as object).length > 0;
  return s.cueLists.some((l) => l.cues.some((c) => Object.values(c.values).some(has)))
    || s.presets.some((p) => has(p.values) || Object.values(p.perFixture ?? {}).some(has))
    || s.groups.some((g) => !!g.cells?.length) || s.effects.some((e) => !!e.cells?.length);
}

// The format the first prototype saved (2026-10-26, never released): { version: 1, types,
// fixtures, cues, loop, devices }, attributes dim / color as an array.
function fromDev(old: any): any {
  const s: any = emptyShow();
  s.fixtureTypes = (Array.isArray(old.types) ? old.types.filter(isObj) : []).map((t: any) => ({
    id: t.id, manufacturer: 'Custom', model: t.name, source: 'user',
    modes: [{ name: 'default', channels: (t.channels ?? []).map((c: any) => ({ ...c, attr: c.attr === 'dimmer' ? 'intensity' : c.attr })) }],
  }));
  s.fixtures = old.fixtures.filter(isObj).map((f: any) => ({ ...f, typeId: devTypeId(f.typeId), mode: 'default' }));
  const vals = (l: any) => {
    const v: any = {};
    if (l.dim !== undefined) v.intensity = l.dim;
    if (l.color) v.color = { r: l.color[0], g: l.color[1], b: l.color[2] };
    for (const k of ['white', 'pan', 'tilt', 'strobe']) if (l[k] !== undefined) v[k] = l[k];
    return v;
  };
  const cues = old.cues.filter(isObj);
  if (cues.length) {
    s.cueLists = [{
      id: 'main', name: 'Main', end: old.loop ? 'loop' : 'stop',
      cues: cues.map((c: any) => ({
        id: c.id, name: c.name, fade: c.fade ?? 2, advance: { mode: 'manual' },
        values: Object.fromEntries(Object.entries(isObj(c.looks) ? c.looks : {}).filter(([, l]) => isObj(l)).map(([id, l]) => [id, vals(l)])),
      })),
    }];
  }
  s.outputs.devices = Array.isArray(old.devices) ? old.devices : [];
  return s;
}
// The prototype's generic ids map 1:1 onto the library's.
const devTypeId = (id: string) => id;
