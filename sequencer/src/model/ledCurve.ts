// How a WS281x pixel really lights for a DMX value, the way a LuxDMX box's pixel port drives it
// (src/pixel_map.h, the same integer sums): every channel through one table of gamma and
// brightness, rounded to the LED's 8 bits, then the power cap scales the lit part down when the
// estimated current is over it. The stage draws what that gives, so what the box turns off (the
// low end of a fade, at a low brightness most of it) is dark on the screen too.
import type { FixtureMode, FixtureType } from './types';

export interface LedCurve {
  gamma: number;          // 1 = linear; a port as it comes: 2.2
  bright: number;         // 0..255, the port's brightness
  maxMa?: number;         // the port's power cap (mA), 0 or none: no cap
  maPerCh?: number;       // what one channel draws at 255 (mA); WS2812: about 20
  idleMa?: number;        // what a dark pixel draws anyway (mA); WS2812: about 1
}
// a pixel port as it comes, with WS2812 numbers
export const WS2812: LedCurve = { gamma: 2.2, bright: 255, maxMa: 0, maPerCh: 20, idleMa: 1 };

const tables = new Map<string, Uint8Array>();
// The box's table: round(255 * x^gamma), then * brightness / 255 (whole numbers, cut down).
export function curveTable(c: LedCurve): Uint8Array {
  const g = Math.round((c.gamma > 0 ? c.gamma : 1) * 100), b = Math.max(0, Math.min(255, Math.round(c.bright))), key = `${g}/${b}`;
  let t = tables.get(key);
  if (!t) {
    t = new Uint8Array(256);
    const ge = Math.fround(g / 100);
    for (let i = 0; i < 256; i++) {
      const x = Math.fround(i / 255), y = ge === 1 ? x : Math.fround(Math.pow(x, ge));
      const v = Math.floor(Math.fround(y * 255 + 0.5));
      t[i] = Math.max(0, Math.min(255, Math.floor((v * b) / 255)));
    }
    tables.set(key, t);
  }
  return t;
}
// The lowest DMX value that still lights an LED at all.
export function firstLit(c: LedCurve): number {
  const t = curveTable(c);
  for (let i = 0; i < 256; i++) if (t[i] > 0) return i;
  return 256;
}

// What the LEDs get for a light's channel values (`pixels` of them): the table, then the power cap.
// `scale` is the cap's factor (256: none), as the box's /pixels.json says it.
export function ledOut(c: LedCurve, bytes: ArrayLike<number>, pixels: number): { out: Uint8Array; scale: number } {
  const t = curveTable(c), out = new Uint8Array(bytes.length);
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) { const v = t[bytes[i] & 255]; out[i] = v; sum += v; }
  const scale = powerScale(c, sum, pixels);
  if (scale < 256) for (let i = 0; i < out.length; i++) out[i] = (out[i] * scale) >> 8;
  return { out, scale };
}
// The power cap's factor (256: none) for a port whose channels add up to `sum` after the table,
// with `pixels` LEDs drawing their idle current (pixEstimateMa and pixPowerScale on the box).
export function powerScale(c: LedCurve, sum: number, pixels: number): number {
  const cap = Math.round(c.maxMa ?? 0);
  if (cap <= 0) return 256;
  const per = Math.round((c.maPerCh ?? WS2812.maPerCh!) * 100), quies = Math.round((c.idleMa ?? WS2812.idleMa!) * 100);
  const est = Math.floor((Math.floor((sum * per) / 255) + pixels * quies) / 100), idle = Math.floor((pixels * quies) / 100);
  if (est <= cap) return 256;
  if (cap <= idle) return 0;
  const litNow = est - idle;
  return litNow === 0 ? 256 : Math.min(256, Math.floor(((cap - idle) * 256) / litNow));
}
// Is a light on a port (somewhere in the universes it reads, from its start channel on)? How many
// universes that is the box says (`spans`: it knows RGBW and packed ports); from a box that doesn't,
// worked out for RGB: whole pixels on each universe (170), its first one from the start channel.
export function onPort(p: PortInfo, f: { universe: number; address: number }): boolean {
  const first = Math.floor((513 - p.start) / 3);
  const spans = Number.isInteger(p.spans) && p.spans! > 0 ? p.spans! : 1 + Math.ceil(Math.max(0, p.count - first) / 170);
  return f.universe === p.uni ? f.address >= p.start : f.universe > p.uni && f.universe < p.uni + spans;
}

// An LED at `o` of 255 on the screen: its light, put back on the screen's own curve (so a pixel
// at full is as bright as any other light at full, and one the box turns off is black).
export const onScreen = (o: number) => (o <= 0 ? 0 : Math.pow(o / 255, 1 / 2.2));

// Is it a WS281x pixel light (a strip, a ring, a disc, a matrix: what a box's pixel port drives)?
// DMX LED bars and lights have their own dimming and keep drawing straight.
export const isPixelType = (t: FixtureType | undefined, m: FixtureMode | undefined) =>
  !!m && (!!m.layout || /^gen-strip/.test(t?.id ?? '')) && m.channels.length > 0 && m.channels.every((c) => c.cell !== undefined);

// A light's curve as a box port reports it (/pixels.json: gamma x100, mA x100).
export interface PortInfo { uni: number; start: number; count: number; spans?: number; bright: number; gamma: number; maxMa: number; mAPerCh: number; quiesMa: number; box?: string }
export const curveOfPort = (p: PortInfo): LedCurve => ({ gamma: p.gamma > 0 ? p.gamma / 100 : 1, bright: p.bright, maxMa: p.maxMa, maPerCh: p.mAPerCh / 100, idleMa: p.quiesMa / 100 });
// One from a file or the box: in range, or the default for what's missing.
export function cleanCurve(v: unknown): Partial<LedCurve> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>, out: Partial<LedCurve> = {};
  const put = (k: keyof LedCurve, lo: number, hi: number) => { const x = o[k]; if (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi) out[k] = x; };
  put('gamma', 1, 4); put('bright', 0, 255); put('maxMa', 0, 200000); put('maPerCh', 0, 200); put('idleMa', 0, 20);
  return Object.keys(out).length ? out : undefined;
}
