// An effect as a package (a .luxfx file): what it is, who made it, which lights it's for, its
// parameters and a little animation for the picker, in one JSON file people send each other and
// repositories serve (ADDONS.md). Our own effects describe themselves this way (`native`: the
// built-in it runs); a Formula carries its formula, a Picture its frames. Nothing in a package is
// ever run as code: a formula goes through our own small language (engine/formula.ts), everything
// else is plain data, read strictly here (unknown fields dropped, sizes bounded).
import { EFFECT_MAP, EFFECTS, paramsOf } from '../engine/effects';
import { knobsOf } from '../engine/knobs';
import { compileCached, compileProgram, FormulaError, LIMITS as FORMULA_LIMITS, PROGRAM_LIMITS } from '../engine/formula';
import { knobId, scriptOf } from '../engine/custom';
import { PICTURE_LIMITS, unpackPicture } from '../engine/custom';
import type { EffectParams } from '../engine/fxkit';
import type { Effect } from '../model/types';

export const PACKAGE_FORMAT = 'luxdmx-effect';
export const PACKAGE_VERSION = 1;
export const PACKAGE_MAX_CHARS = 2_000_000;

// ---------------------------------------------------------------- the standard parameters
// What the app gives every effect the same way (it draws the controls, the effect gets the values);
// a package says which of them change it.
export type Standard = 'speed' | 'level' | 'size' | 'spread' | 'direction' | 'order' | 'blocks' | 'width' | 'range' | 'contrast' | 'palette' | 'orientation';
export const STANDARD: Record<Standard, { name: string; description: string }> = {
  speed: { name: 'Speed', description: 'How long a round takes, in seconds or in beats of the show tempo' },
  level: { name: 'Strength', description: 'How much of the effect goes over the look underneath' },
  size: { name: 'Size', description: 'How big it is: how far it moves, how deep it swings, how big the picture' },
  spread: { name: 'Spread', description: 'All lights together, or each a step further on' },
  direction: { name: 'Direction', description: 'Which way it runs over the lights' },
  order: { name: 'Order', description: 'Which light comes first: the list, or where they are on the stage' },
  blocks: { name: 'Blocks', description: 'Neighbours that move together' },
  width: { name: 'Width', description: 'How long each step is on' },
  range: { name: 'Dim to / Bright to', description: 'The darkest and the brightest it goes' },
  contrast: { name: 'Contrast', description: 'How hard the light falls between dark and bright' },
  palette: { name: 'Colours', description: 'The colours it uses' },
  orientation: { name: 'Orientation', description: 'On a ring or a matrix: mirrored, so what turns turns the other way' },
};
export const STANDARDS = Object.keys(STANDARD) as Standard[];

// Which lights an effect is made for (the library sorts by it).
export type Fit = 'ring' | 'disc' | 'matrix' | 'strip' | 'bar' | 'lights' | 'heads';
export const FITS: Fit[] = ['ring', 'disc', 'matrix', 'strip', 'bar', 'lights', 'heads'];

// ---------------------------------------------------------------- own parameters
interface Base { id: string; name: string; description?: string }
export type ParamSpec =
  | Base & { type: 'number'; min: number; max: number; step?: number; default: number; unit?: string }
  | Base & { type: 'choice'; choices: { value: string; name: string }[]; default: string }
  | Base & { type: 'toggle'; default: boolean }
  | Base & { type: 'colour'; default: string }
  | Base & { type: 'text'; default: string; maxLength: number };

export interface EffectPackage {
  format: typeof PACKAGE_FORMAT;
  formatVersion: number;
  id: string;                 // "author.effect", lower case
  version: string;            // 1.0.0
  name: string;
  author: { name: string; url?: string };
  license: string;            // an SPDX id: MIT, CC-BY-4.0, ...
  description: string;
  tags: string[];
  category: 'move' | 'color' | 'intensity' | 'pixel';
  fits: Fit[];
  preview?: string;           // a little animation for the picker (pic1:, see FORMAT.md)
  uses: Standard[];
  params: ParamSpec[];
  defaults: Record<string, unknown>;   // the standard parameters' starting values
  native?: string;            // the built-in effect it runs
  // (luxfx-1 `speed`: the Speed at which its `t` is real seconds; without it, `defaults.speed`)
  code?: { lang: 'formula-1'; pixel: string } | { lang: 'luxfx-1'; frame?: string; pixel: string; speed?: number };
  media?: { clip: string };   // a picture, a GIF or a video as frames (pic1:)
}

// ---------------------------------------------------------------- our own effects as packages
function usesOf(kind: string): Standard[] {
  const live = knobsOf(kind), def = EFFECT_MAP.get(kind), out = new Set<Standard>(['level']);
  for (const k of live) {
    if (k === 'low' || k === 'high') out.add('range');
    else if (k === 'colors') out.add('palette');
    else if (k === 'direction' && def?.shape) out.add('orientation');
    else out.add(k as Standard);
  }
  if (live.has('spread') || live.has('direction') || live.has('blocks')) out.add('order');
  return STANDARDS.filter((s) => out.has(s));
}
function fitsOf(kind: string): Fit[] {
  const def = EFFECT_MAP.get(kind);
  const fits: Fit[] = !def ? ['lights'] : def.shape ? ['ring', 'disc', 'matrix'] : def.category === 'move' ? ['heads']
    : def.category === 'pixel' ? ['strip', 'bar', 'matrix', 'ring', 'disc'] : ['lights', 'bar', 'strip'];
  return FITS.filter((f) => fits.includes(f));
}
// (the params a built-in keeps beyond the standard ones)
const OWN: Record<string, ParamSpec[]> = {
  scrollText: [{ id: 'text', name: 'Words', description: 'What runs across', type: 'text', default: 'LUXDMX', maxLength: 200 }],
};
const STANDARD_KEYS = ['speed', 'tempo', 'size', 'spread', 'direction', 'blocks', 'width', 'colors', 'low', 'high', 'lightUp', 'level', 'contrast', 'pixels', 'order'];
const pick = (p: Partial<EffectParams>, keys: string[]) => Object.fromEntries(Object.entries(p).filter(([k, v]) => keys.includes(k) && v !== undefined));

export function builtinPackage(kind: string): EffectPackage {
  const def = EFFECT_MAP.get(kind);
  if (!def) throw new Error(`no effect ${kind}`);
  return {
    format: PACKAGE_FORMAT, formatVersion: PACKAGE_VERSION, id: `luxdmx.${kind.toLowerCase()}`, version: '1.0.0', name: def.name,
    author: { name: 'LuxDMX', url: 'https://github.com/tombueng/LuxDMX' }, license: 'MIT', description: def.blurb, tags: def.shape ? ['ring', 'matrix'] : [def.category],
    category: def.category, fits: fitsOf(kind), uses: usesOf(kind), params: OWN[kind] ?? [],
    defaults: JSON.parse(JSON.stringify(pick(def.defaults, STANDARD_KEYS))), native: kind,
  };
}
export const builtinPackages = () => EFFECTS.filter((d) => !['formula', 'picture', 'script'].includes(d.id)).map((d) => builtinPackage(d.id));

// An effect from a show, as it's set (its knobs, its formula or its picture), to send to someone.
export function packageOfEffect(e: Effect, about: { name?: string; author: string; url?: string; description?: string; license?: string; tags?: string[] }): EffectPackage {
  const p = paramsOf(e.kind, e.params as Record<string, unknown>), def = EFFECT_MAP.get(e.kind);
  const name = (about.name ?? e.name ?? def?.name ?? 'Effect').trim().slice(0, 60);
  const base: EffectPackage = {
    format: PACKAGE_FORMAT, formatVersion: PACKAGE_VERSION, id: `${slug(about.author)}.${slug(name)}`, version: '1.0.0', name,
    author: { name: about.author.trim().slice(0, 60), ...(about.url ? { url: about.url } : {}) }, license: about.license ?? 'CC-BY-4.0',
    description: (about.description ?? def?.blurb ?? '').slice(0, 1000), tags: (about.tags ?? []).slice(0, 12),
    category: def?.category ?? 'pixel', fits: fitsOf(e.kind), uses: usesOf(e.kind), params: OWN[e.kind] ?? [],
    defaults: JSON.parse(JSON.stringify(pick(p, STANDARD_KEYS))),
  };
  if (e.kind === 'script') {
    const sc = scriptOf(p.script);
    if (!sc) throw new PackageError('This add-on has nothing in it');
    const vals = p.vals ?? {};
    const params = (sc.params as ParamSpec[]).map((q) => (vals[q.id] !== undefined ? { ...q, default: vals[q.id] } : q)) as ParamSpec[];
    // (the Speed its time runs at 1:1 travels with it: the knobs as set are its new defaults)
    return { ...base, name: about.name ?? sc.name, category: 'pixel', fits: ['ring', 'disc', 'matrix'], uses: (sc.uses ?? ['level']) as Standard[], params,
      code: { lang: 'luxfx-1', ...(sc.frame ? { frame: sc.frame } : {}), pixel: sc.pixel, speed: sc.speed ?? 8 } };
  }
  if (e.kind === 'formula') return { ...base, uses: STANDARDS.filter((s) => s !== 'orientation'), code: { lang: 'formula-1', pixel: p.formula } };
  if (e.kind === 'picture') {
    if (!p.picture) throw new PackageError('Give it a picture first');
    return { ...base, media: { clip: p.picture }, defaults: { ...base.defaults, mapping: p.mapping } };
  }
  return { ...base, native: e.kind, defaults: { ...base.defaults, ...(p.text !== undefined && OWN[e.kind]?.some((x) => x.id === 'text') ? { text: p.text } : {}) } };
}
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';

// What to put in a show for a package: the effect it runs and its parameters.
export function effectOfPackage(pkg: EffectPackage): { kind: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = { ...pkg.defaults };
  for (const q of pkg.params) if (params[q.id] === undefined) params[q.id] = q.default;
  if (pkg.native) return { kind: pkg.native, params };
  if (pkg.code?.lang === 'luxfx-1') {
    const vals: Record<string, unknown> = {}, rest: Record<string, unknown> = { ...pkg.defaults };
    for (const q of pkg.params) vals[q.id] = q.default;
    const speed = pkg.code.speed ?? (typeof pkg.defaults.speed === 'number' ? pkg.defaults.speed : 8);
    const script = { id: pkg.id, name: pkg.name, ...(pkg.code.frame ? { frame: pkg.code.frame } : {}), pixel: pkg.code.pixel, params: pkg.params, uses: pkg.uses, speed, defaults: pkg.defaults };
    return { kind: 'script', params: { ...rest, script: JSON.stringify(script), vals } };
  }
  if (pkg.code) return { kind: 'formula', params: { ...params, formula: pkg.code.pixel } };
  return { kind: 'picture', params: { ...params, picture: pkg.media!.clip } };
}

// ---------------------------------------------------------------- reading one, strictly
export class PackageError extends Error {}
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number, what: string, need = true): string => {
  if (v === undefined && !need) return '';
  if (typeof v !== 'string' || (need && !v.trim()) || v.length > max) throw new PackageError(`${what} is missing or too long`);
  return v;
};
const num = (v: unknown, what: string) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new PackageError(`${what} isn't a number`); return v; };
const ID = /^[a-z0-9][a-z0-9-]{0,40}\.[a-z0-9][a-z0-9-]{0,40}$/, PARAM = /^[a-z][a-zA-Z0-9]{0,31}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', ...STANDARD_KEYS, 'formula', 'picture', 'mapping', 'sound']);
const HEX = /^#[0-9a-fA-F]{6}$/;

function readParam(v: unknown, i: number): ParamSpec {
  if (!isObj(v)) throw new PackageError(`Parameter ${i + 1} isn't readable`);
  const id = str(v.id, 32, `Parameter ${i + 1}'s id`);
  if (!PARAM.test(id) || RESERVED.has(id) || !knobId(id)) throw new PackageError(`Parameter id "${id}" can't be used`);
  const base = { id, name: str(v.name, 40, `Parameter ${id}'s name`), ...(typeof v.description === 'string' ? { description: v.description.slice(0, 300) } : {}) };
  switch (v.type) {
    case 'number': {
      const min = num(v.min, `${id}'s min`), max = num(v.max, `${id}'s max`), d = num(v.default, `${id}'s default`);
      if (!(min < max) || d < min || d > max) throw new PackageError(`${id}: its range or default doesn't fit`);
      return { ...base, type: 'number', min, max, default: d, ...(typeof v.step === 'number' && v.step > 0 ? { step: v.step } : {}), ...(typeof v.unit === 'string' ? { unit: v.unit.slice(0, 12) } : {}) };
    }
    case 'choice': {
      if (!Array.isArray(v.choices) || !v.choices.length || v.choices.length > 32) throw new PackageError(`${id}: its choices aren't readable`);
      const choices = v.choices.map((c, k) => { if (!isObj(c)) throw new PackageError(`${id}: choice ${k + 1}`); return { value: str(c.value, 40, `${id}'s choice`), name: str(c.name, 40, `${id}'s choice name`) }; });
      const d = str(v.default, 40, `${id}'s default`);
      if (!choices.some((c) => c.value === d)) throw new PackageError(`${id}: its default isn't one of its choices`);
      return { ...base, type: 'choice', choices, default: d };
    }
    case 'toggle': if (typeof v.default !== 'boolean') throw new PackageError(`${id}: its default isn't on or off`); return { ...base, type: 'toggle', default: v.default };
    case 'colour': { const d = str(v.default, 7, `${id}'s default`); if (!HEX.test(d)) throw new PackageError(`${id}: its default isn't a colour like #ff8000`); return { ...base, type: 'colour', default: d }; }
    case 'text': { const max = Math.min(500, Math.max(1, Math.round(num(v.maxLength ?? 200, `${id}'s maxLength`)))); return { ...base, type: 'text', default: str(v.default, max, `${id}'s default`, false), maxLength: max }; }
    default: throw new PackageError(`${id}: no such parameter type "${String(v.type)}"`);
  }
}
function readPic(v: unknown, what: string): string {
  const s = str(v, PICTURE_LIMITS.chars, what);
  try { unpackPicture(s); } catch { throw new PackageError(`${what} isn't a picture this app can read`); }
  return s;
}
// The standard parameters' values: only known keys, each its own sort (the effect cleans the rest).
function readDefaults(v: unknown): Record<string, unknown> {
  if (v === undefined) return {};
  if (!isObj(v)) throw new PackageError('Its defaults aren\'t readable');
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'colors') { if (Array.isArray(x) && x.length <= 8) out.colors = x.filter((c) => isObj(c) && ['r', 'g', 'b'].every((q) => typeof c[q] === 'number' && (c[q] as number) >= 0 && (c[q] as number) <= 1)).map((c) => ({ r: (c as Obj).r, g: (c as Obj).g, b: (c as Obj).b })); continue; }
    if (['tempo', 'lightUp', 'pixels'].includes(k)) { if (typeof x === 'boolean') out[k] = x; continue; }
    if (['direction', 'order', 'mapping'].includes(k) || k === 'text') { if (typeof x === 'string' && x.length <= 200) out[k] = x; continue; }
    if (STANDARD_KEYS.includes(k) && typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  }
  return out;
}

export function readPackage(text: string): EffectPackage {
  if (text.length > PACKAGE_MAX_CHARS) throw new PackageError('It\'s too big for an effect');
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new PackageError('That isn\'t an effect file (not JSON)'); }
  if (!isObj(v) || v.format !== PACKAGE_FORMAT) throw new PackageError('That isn\'t a LuxDMX effect');
  if (typeof v.formatVersion !== 'number' || v.formatVersion > PACKAGE_VERSION) throw new PackageError('It was made for a newer LuxDMX Sequencer: update the app');
  const id = str(v.id, 81, 'Its id');
  if (!ID.test(id)) throw new PackageError(`Its id "${id}" isn't like "author.effect"`);
  if (!isObj(v.author)) throw new PackageError('It doesn\'t say who made it');
  const url = typeof v.author.url === 'string' && /^https:\/\/[^\s]{1,200}$/.test(v.author.url) ? v.author.url : undefined;
  const category = (['move', 'color', 'intensity', 'pixel'] as const).find((c) => c === v.category) ?? 'pixel';
  const params = Array.isArray(v.params) ? v.params.slice(0, 24).map(readParam) : [];
  if (new Set(params.map((q) => q.id)).size !== params.length) throw new PackageError('Two parameters have the same id');
  const pkg: EffectPackage = {
    format: PACKAGE_FORMAT, formatVersion: PACKAGE_VERSION, id, version: str(v.version ?? '1.0.0', 20, 'Its version'), name: str(v.name, 60, 'Its name'),
    author: { name: str(v.author.name, 60, 'Its author'), ...(url ? { url } : {}) }, license: str(v.license ?? 'unknown', 40, 'Its license'),
    description: str(v.description ?? '', 1000, 'Its description', false), tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string' && t.length <= 24).slice(0, 12) : [],
    category, fits: Array.isArray(v.fits) ? FITS.filter((f) => (v.fits as unknown[]).includes(f)) : [],
    uses: Array.isArray(v.uses) ? STANDARDS.filter((s) => (v.uses as unknown[]).includes(s)) : ['level'],
    params, defaults: readDefaults(v.defaults),
  };
  if (!pkg.fits.length) pkg.fits = ['lights'];
  if (v.preview !== undefined) pkg.preview = readPic(v.preview, 'Its preview');
  // what it runs: one of a built-in, a formula, a picture
  if (typeof v.native === 'string') {
    if (!EFFECT_MAP.has(v.native) || ['formula', 'picture', 'script'].includes(v.native)) throw new PackageError(`It needs the effect "${v.native}", which this app doesn't have: update the app`);
    pkg.native = v.native;
  } else if (isObj(v.code) && v.code.lang === 'luxfx-1') {
    const frame = str(v.code.frame ?? '', PROGRAM_LIMITS.length, 'Its frame part', false), pixel = str(v.code.pixel, PROGRAM_LIMITS.length, 'Its code');
    try { compileProgram({ frame, pixel }, params); } catch (e) {
      if (e instanceof FormulaError) throw new PackageError(`Its code doesn't read (${e.part ?? 'pixel'} part, at ${e.pos}): ${e.message}`);
      throw e;
    }
    const sp = v.code.speed;
    pkg.code = { lang: 'luxfx-1', ...(frame ? { frame } : {}), pixel, ...(typeof sp === 'number' && Number.isFinite(sp) && sp >= 0.05 && sp <= 3600 ? { speed: sp } : {}) };
  } else if (isObj(v.code)) {
    if (v.code.lang !== 'formula-1') throw new PackageError('It\'s written in a language this app doesn\'t know yet: update the app');
    pkg.code = { lang: 'formula-1', pixel: str(v.code.pixel, FORMULA_LIMITS.length, 'Its formula') };
    const f = compileCached(pkg.code.pixel);
    if (f instanceof FormulaError) throw new PackageError(`Its formula doesn't read: ${f.message}`);
  } else if (isObj(v.media)) {
    pkg.media = { clip: readPic(v.media.clip, 'Its picture') };
  } else throw new PackageError('It doesn\'t say what to play');
  return pkg;
}
