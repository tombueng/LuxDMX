// Starter looks for any rig: a cue list of moods made from what the fixtures can do (colour, white,
// position, plain dimmers), laid out across the stage the way a designer would start: a warm wash,
// a cool one, gradients left to right, two-colour splits, a party look with a rainbow running.
// Colours come from the show's colour presets when they're there, so the looks follow the presets.
import type { Color, Cue, CueList, Effect, Fixture, Show, Values } from '../model/types';

export interface RigCaps { color: boolean; position: boolean; cct: boolean; light: boolean }

const lerp = (a: Color, b: Color, t: number): Color => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const C = {
  warm: { r: 1, g: 0.72, b: 0.42 }, cool: { r: 0.8, g: 0.9, b: 1 }, red: { r: 1, g: 0, b: 0 }, orange: { r: 1, g: 0.45, b: 0 },
  magenta: { r: 1, g: 0, b: 0.75 }, purple: { r: 0.55, g: 0, b: 1 }, deepBlue: { r: 0.05, g: 0, b: 0.6 }, blue: { r: 0, g: 0.15, b: 1 },
  cyan: { r: 0, g: 0.9, b: 1 }, green: { r: 0, g: 1, b: 0.1 }, amber: { r: 1, g: 0.65, b: 0.1 },
} satisfies Record<string, Color>;

interface Look { name: string; mood: (f: Fixture, u: number, k: number) => { color?: Color; intensity: number; preset?: string }; fx?: string; tilt?: number }

// u: where the light is across the stage (0 left .. 1 right), k: its index among the coloured ones.
const LOOKS: Look[] = [
  { name: 'Warm wash', mood: () => ({ color: C.warm, intensity: 0.85, preset: 'Warm white' }) },
  { name: 'Cool wash', mood: () => ({ color: C.cool, intensity: 0.75, preset: 'Cool white' }) },
  { name: 'Sunset', mood: (_, u) => ({ color: lerp(C.orange, C.magenta, u), intensity: 0.9 }) },
  { name: 'Ocean', mood: (_, u) => ({ color: lerp(C.deepBlue, C.cyan, u), intensity: 0.8 }) },
  { name: 'Red and blue', mood: (_, __, k) => ({ color: k % 2 ? C.blue : C.red, intensity: 1, preset: k % 2 ? 'Blue' : 'Red' }) },
  { name: 'Purple haze', mood: (_, u) => ({ color: lerp(C.purple, C.deepBlue, Math.abs(u - 0.5) * 2), intensity: 0.7 }) },
  { name: 'Forest', mood: (_, __, k) => ({ color: k % 3 === 1 ? C.amber : C.green, intensity: 0.75 }) },
  { name: 'Party', mood: () => ({ intensity: 1 }), fx: 'rainbow', tilt: 0.75 },
];

// Fixtures with `caps`, presets by name; returns the list and the effects it needs.
export function starterLooks(show: Show, caps: (id: string) => RigCaps, newId: (prefix: string) => string, name = 'Starter looks'): { list: CueList; effects: Effect[] } {
  const fx = [...show.fixtures].filter((f) => caps(f.id).light).sort((a, b) => a.x - b.x);
  const colored = fx.filter((f) => caps(f.id).color);
  const byName = new Map(show.presets.filter((p) => p.kind === 'color').map((p) => [p.name.toLowerCase(), p.id]));
  const xs = fx.map((f) => f.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const list: CueList = { id: newId('l'), name, cues: [], end: 'stop' };
  const effects: Effect[] = [];
  LOOKS.forEach((look, li) => {
    if (!colored.length && li > 1) return;                 // dimmers only: a warm and a cool level is all there is
    const values: Record<string, Values> = {};
    for (const f of fx) {
      const u = x1 > x0 ? (f.x - x0) / (x1 - x0) : 0.5;
      const m = look.mood(f, u, colored.indexOf(f));
      const v: Values = { intensity: m.intensity };
      const c = caps(f.id);
      if (c.color && m.color) {
        const pid = m.preset && byName.get(m.preset.toLowerCase());
        v.color = pid ? { preset: pid } : m.color;
      }
      if (c.cct && !c.color && m.color) v.cct = look.name.startsWith('Cool') ? 0.8 : 0.25;
      if (c.position) Object.assign(v, { pan: 0.5, tilt: look.tilt ?? 0.62 });
      values[f.id] = v;
    }
    const cue: Cue = { id: newId('c'), name: look.name, values, fade: 2, advance: { mode: 'manual' } };
    if (look.fx && colored.length) {
      const e: Effect = { id: newId('e'), name: `${look.name}: rainbow`, kind: look.fx, fixtures: colored.map((f) => f.id), params: {} };
      effects.push(e);
      cue.effects = [e.id];
    }
    list.cues.push(cue);
  });
  return { list, effects };
}
