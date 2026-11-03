// Every bar and pixel strip placed by a template or a demo shines towards the audience side,
// never away from it or along the stage (a strip stood upright with its cells turned sideways). In
// the demos' own rooms the audience is where their crowd is (the test truss: in front of it).
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../content/templates';
import { buildDemo } from '../content/demo';
import { DEMOS } from '../content/demos';
import { kindOf, modeOf, typeMap } from '../model/library';
import { D, DECK, defaultPlace, roomOf, toWorld, type V3 } from './geometry';
import type { Show } from '../model/types';

// where the audience is: in front of the stage, at head height
const AUDIENCE = { x: 0, y: DECK + 0.5, z: D / 2 + 8 };
const CROWD: Record<string, V3> = { club: { x: 0, y: 1.7, z: 12 }, party: { x: 0, y: 1.7, z: 8 }, truss: { x: 0, y: 1.7, z: 9 } };
function wrong(show: Show, aud: V3 = AUDIENCE) {
  const types = typeMap(show), bad: string[] = [];
  for (const f of show.fixtures) {
    if (kindOf(modeOf(types.get(f.typeId), f.mode)) !== 'bar') continue;
    // (its own place, or where the 3D stage puts a bar that has none)
    const def = defaultPlace(f, 'bar', roomOf(show.settings.stage3d?.room)), p = f.p3 ?? def.p, rot = f.rot ?? def.rot;
    const d = toWorld({ x: 0, y: 1, z: 0 }, rot);             // a bar's cells shine along its up
    const a = { x: aud.x - p.x, y: aud.y - p.y, z: aud.z - p.z }, n = Math.hypot(a.x, a.y, a.z);
    const towards = (d.x * a.x + d.y * a.y + d.z * a.z) / n;
    if (towards < 0.3) bad.push(`${f.name} (${towards.toFixed(2)})`);
  }
  return bad;
}

describe('bars face the audience', () => {
  it('in the big demo', () => expect(wrong(buildDemo())).toEqual([]));
  for (const t of TEMPLATES) it(`in "${t.name}"`, () => expect(wrong(t.build())).toEqual([]));
  for (const d of DEMOS.filter((x) => x.room !== 'hall')) it(`in the demo "${d.name}"`, () => {
    const s = d.build();
    expect(s.fixtures.filter((f) => kindOf(modeOf(typeMap(s).get(f.typeId), f.mode)) === 'bar').length).toBeGreaterThan(3);
    expect(wrong(s, CROWD[d.room])).toEqual([]);
  });
});
