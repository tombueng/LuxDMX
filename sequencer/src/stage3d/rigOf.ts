// A light as the 3D stage draws it (rig.ts RigFixture): which body it gets, where it is, its gobo
// wheels, prism, animation wheel, beam angle, moving-bar heads, winch and extra axes. One mapping
// for the 3D stage (Stage3D.svelte) and the library's live previews (preview.ts), so a preview
// shows what the stage will.
import type { Fixture, FixtureMode, FixtureType } from '../model/types';
import type { FixtureKind } from '../model/library';
import { capsOf, headCellsOf } from '../model/library';
import { slotsOf } from '../engine/render';
import { wheelPatterns } from './gobos';
import { opticsOf } from '../model/fixtureSetup';
import { placesOfLight, shapeSize, shapeStanding } from '../model/pixelLayout';
import { defaultPlace, type Room } from './geometry';
import type { GoboWheel, RigFixture, Sfx } from './rig';
import type { Look } from './models';

const SFX: Sfx[] = ['confetti', 'bubbles', 'flame', 'sparks', 'co2'];
type Mode = FixtureMode | undefined;
const chOf = (m: Mode, attr: string) => m?.channels.find((ch) => ch.attr === attr && !ch.fine && ch.cell === undefined);

export function goboWheelsOf(m: Mode): GoboWheel[] | undefined {
  const out: GoboWheel[] = [];
  for (const [attr, rotAttr] of [['gobo', 'goboRotation'], ['gobo2', 'gobo2Rotation']] as const) {
    const c = chOf(m, attr);
    if (!c) continue;
    const r = chOf(m, rotAttr);
    out.push({ attr, rotAttr, slots: wheelPatterns(slotsOf(c).map((x) => x.label ?? '')), rot: r?.ranges });
  }
  return out.length ? out : undefined;
}
export function prismOfMode(m: Mode): RigFixture['prism'] {
  const c = chOf(m, 'prism');
  return c ? { ranges: c.ranges, rot: chOf(m, 'prismRotation')?.ranges } : undefined;
}

// every light as the 3D stage needs it (a light without a 3D place of its own goes where its plan
// position puts it in this room)
export function rigFixtureFull(f: Fixture, m: Mode, k: FixtureKind, t: FixtureType | undefined, room: Room): RigFixture {
  const c = capsOf(m);
  const def = defaultPlace(f, k, room);
  // a ring or a matrix stands up on its lower edge, facing the audience, unless it's been placed
  const shape = placesOfLight(f, m), size = shape && shapeSize(shape);
  const sfx = m?.channels.find((ch) => (SFX as string[]).includes(ch.attr))?.attr as Sfx | undefined;
  const has = (a: string) => !!m?.channels.some((ch) => ch.attr === a);
  const look: Look = sfx ?? (has('hoist') ? 'winch' : c.fog ? 'fog' : k === 'mover' ? (c.heads > 1 ? 'headbar' : /wash/i.test(t?.model ?? '') || (has('zoom') && !has('gobo')) ? 'wash' : 'spot')
    : shape ? (shape.round ? 'disc' : 'panel') : k === 'bar' ? 'bar' : k === 'strobe' ? 'strobe' : k === 'par' ? 'par' : /blinder/i.test(t?.model ?? '') ? 'blinder' : 'fresnel');
  return {
    id: f.id, name: f.name, kind: k, look, cells: Math.max(1, c.cells), sfx, fog: c.fog, hazer: c.fog && has('haze') && !has('fog'),
    p: f.p3 ? { ...f.p3 } : shape ? shapeStanding(def.p, shape).p : def.p, rot: f.rot ? { ...f.rot } : shape ? shapeStanding(def.p, shape).rot : def.rot, shape, size,
    // (the light's own pan / tilt range first, then its type's; swapped when it says so)
    optics: { ...opticsOf(f, t), swap: !!f.swapPanTilt },
    // its gobo wheels: each slot's pattern from its name (gobos.ts), and its rotation channel's ranges
    gobos: look === 'spot' ? goboWheelsOf(m) : undefined,
    // its prism (facets from the prism channel's ranges) and its animation wheel
    prism: look === 'spot' ? prismOfMode(m) : undefined,
    anim: look === 'spot' && has('animation') ? { rot: chOf(m, 'animationRotation')?.ranges } : undefined,
    // its beam's opening angle: its own, else its type's data (else the 3D stage guesses by its kind)
    beam: f.beamDeg ?? t?.physical?.beamDeg,
    ...(c.heads > 1 && m ? { heads: c.heads, headCells: headCellsOf(m), headPan: c.cellMoves.includes('pan'), barPan: m.channels.some((ch) => ch.attr === 'pan' && ch.cell === undefined) } : {}),
    // a winch: its travel and speed from its type (a guess without), its soft limits
    ...(has('hoist') ? { winch: { travel: t?.physical?.travel ?? 4, speed: t?.physical?.hoistSpeed ?? 0.4, ...(f.hoistLimits ? { limits: f.hoistLimits } : {}) } } : {}),
    // more than two axes: endless pan and tilt, a third axis (roll) and its endless turning
    axes: has('panRotation') || has('tiltRotation') || has('roll') || has('rollRotation') ? {
      ...(has('panRotation') ? { panRot: chOf(m, 'panRotation')?.ranges ?? null } : {}), ...(has('tiltRotation') ? { tiltRot: chOf(m, 'tiltRotation')?.ranges ?? null } : {}),
      ...(has('roll') || has('rollRotation') ? { rollDeg: t?.physical?.rollDeg || 360 } : {}), ...(has('rollRotation') ? { rollRot: chOf(m, 'rollRotation')?.ranges ?? null } : {}),
    } : undefined,
  };
}
