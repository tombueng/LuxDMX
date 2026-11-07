// A small starter for LED rings and matrices on a box's pixel ports: a 241-pixel disc, a 16 x 16
// matrix, a 60-pixel ring and a 32 x 8 banner, with lists of the effects made for them. Not a rig
// like the other templates (no PARs, no machines), so it isn't one of TEMPLATES, only offered next
// to them. It starts on universe 10: a box's DMX outputs usually sit on the first few.
import type { Show } from '../model/types';
import { Builder, on, TEMPLATES, type Template } from './templates';

export function buildRingMatrix(): Show {
  const b = new Builder('Ring and matrix');
  b.s.settings.bpm = 124;
  const disc = b.add('gen-disc241', 1, 'Disc', 0.55, { universe: 10, x0: 0.22, x1: 0.22 });      // universes 10 and 11
  const matrix = b.add('gen-matrix16x16', 1, 'Matrix', 0.55, { universe: 12, x0: 0.5, x1: 0.5 });   // 12 and 13
  const ring = b.add('gen-ring60', 1, 'Ring', 0.55, { universe: 14, x0: 0.78, x1: 0.78 });          // 14
  const banner = b.add('gen-matrix32x8', 1, 'Banner', 0.2, { universe: 15, x0: 0.5, x1: 0.5 });     // 15 and 16
  const everything = [...disc, ...matrix, ...ring, ...banner];
  const all = b.group('Ring and matrix', everything), gBanner = b.group('Banner', banner);
  b.group('Disc', disc); b.group('Matrix', matrix); b.group('Ring', ring);

  // One list per mood, each cue one effect on all of them for as long as it's worth watching.
  const play = (name: string, color: string, cues: [string, string, number][]) => {
    const l = b.list(name, { end: 'loop', color });
    for (const [cue, kind, secs] of cues)
      b.cue(l, cue, [[everything, on(1)]], { fade: 0.8, effects: [b.effect(cue, kind, all)], advance: { mode: 'wait', time: secs } });
    return l;
  };
  play('Stories', '#ffb020', [['Eye', 'eye', 30], ['Reactor', 'reactor', 25], ['Supernova', 'supernova', 22], ['Radar', 'radar', 26]]);
  play('Space', '#5070ff', [['Black hole', 'blackHole', 32], ['Warp', 'warp', 28], ['Galaxy', 'galaxy', 28], ['Hypno', 'hypno', 24], ['Mandala', 'mandala', 24], ['Tunnel', 'tunnel', 16]]);
  play('Party', '#ff10a0', [['Kick rings', 'kickRings', 16], ['Equaliser', 'equaliser', 16], ['Sky rockets', 'skyRockets', 18], ['Big heart', 'bigHeart', 12], ['Plasma', 'plasmaClouds', 20]]);
  play('Calm', '#35d070', [['Lava lamp', 'lavaLamp', 30], ['Raindrops', 'raindrops', 24], ['Campfire', 'campfire', 30], ['Code rain', 'codeRain', 24]]);
  const words = b.list('Words', { color: '#ffffff' });
  b.cue(words, 'LUXDMX', [[banner, on(1)]], { fade: 0.3, effects: [b.effect('Words', 'scrollText', gBanner, { text: 'LUXDMX' })] });
  const check = b.list('Check the wiring', { color: '#8a94a3' });
  b.cue(check, 'Wiring test', [[everything, on(1)]], { fade: 0, effects: [b.effect('Wiring test', 'wiringTest', all)] });
  return b.done();
}

export const RING_MATRIX: Template = {
  name: 'Ring and matrix', icon: 'sun', build: buildRingMatrix,
  blurb: 'LED rings and matrices on a box\'s pixel ports: a disc, a matrix, a ring and a banner, with stories, space, party and calm effects ready to play.',
};
export const ALL_TEMPLATES: Template[] = [...TEMPLATES, RING_MATRIX];
