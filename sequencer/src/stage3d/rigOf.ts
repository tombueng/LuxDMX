// A light as the 3D stage draws it (rig.ts RigFixture): which body it gets, where it is, its gobo
// wheels, prism, animation wheel, beam angle, moving-bar heads, winch and extra axes. One mapping
// for the 3D stage (Stage3D.svelte) and the library's live previews (preview.ts), so a preview
// shows what the stage will.
import type { Fixture, FixtureMode, FixtureType } from '../model/types';
import { FIXED_SIZE, isFixedLook } from './lightSize';
import type { FixtureKind } from '../model/library';
import { capsOf, headCellsOf, machineryOf } from '../model/library';
import { slotsOf } from '../engine/render';
import { wheelPatterns } from './gobos';
import { opticsOf } from '../model/fixtureSetup';
import { placesOfLight, shapeSize, shapeStanding, shapeW } from '../model/pixelLayout';
import { DECK, defaultPlace, type Room } from './geometry';
import type { GoboWheel, RigFixture, Sfx } from './rig';
import { lookWidth, type Look } from './models';
import { profileOf } from './profiles';
import { isDropPicture } from './drops';

const SFX: Sfx[] = ['confetti', 'bubbles', 'flame', 'sparks', 'co2'];
type Mode = FixtureMode | undefined;
const chOf = (m: Mode, attr: string) => m?.channels.find((ch) => ch.attr === attr && !ch.fine && ch.cell === undefined);

// (worked out once per mode: a type is never changed in place, saving one makes a new object. Every
// light's 3D look is made again on any change to any light, a gizmo drag on every pointer move, and
// reading the gobo names was most of that. What's made here is shared and only ever read.)
const wheelsMemo = new WeakMap<FixtureMode, GoboWheel[] | undefined>(), prismMemo = new WeakMap<FixtureMode, RigFixture['prism']>();
export function goboWheelsOf(m: Mode): GoboWheel[] | undefined {
  if (!m) return undefined;
  if (wheelsMemo.has(m)) return wheelsMemo.get(m);
  const w = wheelsFrom(m);
  wheelsMemo.set(m, w);
  return w;
}
function wheelsFrom(m: Mode): GoboWheel[] | undefined {
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
  if (!m) return undefined;
  if (prismMemo.has(m)) return prismMemo.get(m);
  const c = chOf(m, 'prism'), p = c ? { ranges: c.ranges, rot: chOf(m, 'prismRotation')?.ranges } : undefined;
  prismMemo.set(m, p);
  return p;
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
  // (stage machinery on a winch channel: a curtain track, a fly bar with its drop; else a kinetic winch)
  const mach = machineryOf(t?.model);
  const machinery: Look | undefined = has('hoist') ? (mach === 'flybar' ? 'flybar' : mach ? 'curtain' : 'winch')
    : /mirror ?ball|disco ?ball|spiegelkugel/i.test(t?.model ?? '') ? 'mirrorball' : undefined;
  // a real fixture drawn as what it is (profiles.ts), when its type is one
  const profile = profileOf(t?.manufacturer, t?.model);
  const look: Look = profile?.head ? 'matrixhead' : profile?.panel ? 'panel' : sfx ?? (machinery ?? (c.fog ? 'fog' : k === 'mover' ? (c.heads > 1 ? 'headbar' : /wash/i.test(t?.model ?? '') || (has('zoom') && !has('gobo')) ? 'wash' : 'spot')
    : shape ? (shape.round ? 'disc' : 'panel') : k === 'bar' ? 'bar' : k === 'strobe' ? 'strobe' : k === 'par' ? 'par' : /blinder/i.test(t?.model ?? '') ? 'blinder' : 'fresnel'));
  const cloth = clothOf(f, look, t);
  // (its size: its own, else its type's; a strip or a bar its length (and its face across, its body's
  // depth), a ring or a matrix its width, anything else drawn that much bigger or smaller, a PAR, a
  // fresnel, a blinder or a strobe stretched by its own face and depth too)
  // (each of w, h, d its own where it has one, else its type's)
  const dims = f.dims || t?.physical?.dims ? { ...t?.physical?.dims, ...f.dims } : undefined, w = dims?.w;
  // (a fixed light: its own face (h) and depth (d) stretch it just that way, over its width's scale)
  const fixed = !shape && !cloth && !profile && isFixedLook(look) ? FIXED_SIZE[look] : undefined, s1 = w ? w / lookWidth(look) : 1;
  return {
    id: f.id, name: f.name, kind: k, look, cells: Math.max(1, c.cells), ...(profile ? { profile } : {}), sfx, fog: c.fog, hazer: c.fog && has('haze') && !has('fog'),
    p: f.p3 ? { ...f.p3 } : shape ? shapeStanding(def.p, shape).p : def.p, rot: f.rot ? { ...f.rot } : shape ? shapeStanding(def.p, shape).rot : def.rot, shape,
    size: shape && w ? w / Math.max(1e-6, shapeW(shape)) : size, ...(!shape && k === 'bar' ? { ...(w ? { barLen: w } : {}), ...(dims?.h ? { barFace: dims.h } : {}), ...(dims?.d ? { barDepth: dims.d } : {}) } : w && !shape && !cloth ? { scale: s1 } : {}),
    ...(fixed && dims?.h ? { scaleZ: dims.h / fixed.h } : {}), ...(fixed && dims?.d ? { scaleY: dims.d / fixed.d } : {}),
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
    // a curtain: each half travels half its width (one that flies out: its height); a fly bar hung
    // somewhere: as far as takes its drop from there down to the deck (else its type's travel)
    ...(cloth ? { cloth, ...(look === 'curtain' ? { winch: { travel: cloth.rises ? cloth.h : cloth.w / 2, speed: t?.physical?.hoistSpeed ?? 0.7, ...(f.hoistLimits ? { limits: f.hoistLimits } : {}) } }
      : f.p3 ? { winch: { travel: Math.max(1, f.p3.y - 0.03 - cloth.h - DECK), speed: t?.physical?.hoistSpeed ?? 0.7, ...(f.hoistLimits ? { limits: f.hoistLimits } : {}) } } : {}) } : {}),
    // more than two axes: endless pan and tilt, a third axis (roll) and its endless turning
    axes: has('panRotation') || has('tiltRotation') || has('roll') || has('rollRotation') ? {
      ...(has('panRotation') ? { panRot: chOf(m, 'panRotation')?.ranges ?? null } : {}), ...(has('tiltRotation') ? { tiltRot: chOf(m, 'tiltRotation')?.ranges ?? null } : {}),
      ...(has('roll') || has('rollRotation') ? { rollDeg: t?.physical?.rollDeg || 360 } : {}), ...(has('rollRotation') ? { rollRot: chOf(m, 'rollRotation')?.ranges ?? null } : {}),
    } : undefined,
  };
}

// A curtain's or a drop's cloth: its own size, else its type's (a curtain spans its track's travel;
// a fly curtain, named so, rises: as high as its winch lifts it), and what's painted on a drop (a
// forest without)
export function clothOf(f: Pick<Fixture, 'cloth'>, look: Look, t: FixtureType | undefined): RigFixture['cloth'] {
  if (look !== 'curtain' && look !== 'flybar') return undefined;
  const own = f.cloth ?? {}, num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  if (look === 'curtain') {
    const rises = machineryOf(t?.model) === 'flycurtain';
    return rises ? { w: num(own.w, 18, 1, 60), h: num(own.h, t?.physical?.travel ?? 10.4, 0.5, 30), rises } : { w: num(own.w, t?.physical?.travel ?? 18, 1, 60), h: num(own.h, 10.4, 0.5, 30) };
  }
  return { w: num(own.w, 18, 1, 60), h: num(own.h, 10.2, 0.5, 30), picture: isDropPicture(own.picture) ? own.picture : 'forest' };
}
