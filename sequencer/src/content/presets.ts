// The presets a new show starts with. Cues store references to them, so changing "Warm white" once
// changes every cue that uses it. Positions are a starting point: aim the heads in your room and
// "Update" them.
import { caps, modeOf, typeMap } from '../model/library';
import type { Color, Preset, Show, Values } from '../model/types';

const hex = (h: string): Color => {
  const n = parseInt(h.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};
const COLORS: [string, string][] = [
  ['Red', '#ff0000'], ['Orange', '#ff7300'], ['Amber', '#ffa61a'], ['Yellow', '#ffe600'], ['Green', '#00ff00'],
  ['Cyan', '#00ffff'], ['Blue', '#0000ff'], ['Deep blue', '#1a0099'], ['Purple', '#9900ff'], ['Magenta', '#ff00ff'],
  ['Pink', '#ff4d99'], ['Warm white', '#ffbf73'], ['White', '#ffffff'], ['Cool white', '#d6e6ff'],
];

export function standardPresets(show?: Show): Preset[] {
  const out: Preset[] = [];
  const p = (id: string, name: string, kind: Preset['kind'], values: Values, perFixture?: Record<string, Values>) =>
    out.push({ id, name, kind, values, ...(perFixture ? { perFixture } : {}), auto: true });
  for (const [name, h] of COLORS) p(`pc-${name.toLowerCase().replace(/ /g, '-')}`, name, 'color', { color: hex(h) });
  for (const [name, v] of [['Full', 1], ['75%', 0.75], ['Half', 0.5], ['25%', 0.25], ['Off', 0]] as const)
    p(`pi-${name.replace(/\W/g, '')}`, name, 'intensity', { intensity: v });
  for (const [name, pan, tilt] of [['Home', 0.5, 0.5], ['Audience', 0.5, 0.75], ['Stage', 0.5, 0.32], ['Left', 0.36, 0.62], ['Right', 0.64, 0.62], ['Up', 0.5, 0.95]] as const)
    p(`pp-${name.toLowerCase()}`, name, 'position', { pan, tilt });
  // Fan and cross need to know the heads: each gets its own pan.
  const types = show ? typeMap(show) : undefined;
  const movers = show?.fixtures.filter((f) => caps(modeOf(types!.get(f.typeId), f.mode)).position) ?? [];
  if (movers.length > 1) {
    const fan: Record<string, Values> = {}, cross: Record<string, Values> = {};
    movers.forEach((f, i) => {
      const x = i / (movers.length - 1) - 0.5;
      fan[f.id] = { pan: 0.5 + x * 0.4, tilt: 0.7 };
      cross[f.id] = { pan: 0.5 - x * 0.3, tilt: 0.65 };
    });
    p('pp-fan', 'Fan out', 'position', { pan: 0.5, tilt: 0.7 }, fan);
    p('pp-cross', 'Cross', 'position', { pan: 0.5, tilt: 0.65 }, cross);
  }
  p('pb-nostrobe', 'No strobe', 'beam', { strobe: 0 });
  p('pb-strobe-slow', 'Strobe slow', 'beam', { strobe: 0.3 });
  p('pb-strobe-fast', 'Strobe fast', 'beam', { strobe: 0.85 });
  p('pb-narrow', 'Narrow', 'beam', { zoom: 0 });
  p('pb-wide', 'Wide', 'beam', { zoom: 1 });
  return out;
}

// Add the standard presets a show doesn't have yet (by id), keeping the user's own.
export function addStandardPresets(show: Show): number {
  const have = new Set(show.presets.map((p) => p.id));
  const add = standardPresets(show).filter((p) => !have.has(p.id));
  show.presets.push(...add);
  return add.length;
}

