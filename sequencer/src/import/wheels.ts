// A head with two gobo wheels (a static and a rotating one, most profile spots): the formats file
// both as "gobo", the app has gobo and gobo2. In a mode's channels, the first wheel stays gobo and
// the second becomes gobo2; a rotation channel goes with its wheel (by the wheel's name when the
// format says it, else in order: the second rotation is the second wheel's).
import type { Channel } from '../model/types';

export function secondWheels(channels: Channel[], wheelOf?: (c: Channel) => string | undefined) {
  const wheels: string[] = [];
  let slots = 0, turns = 0;
  for (const c of channels) {
    if (c.fine) continue;
    if (c.attr === 'gobo') {
      const w = wheelOf?.(c) ?? `#${slots}`;
      if (!wheels.includes(w)) wheels.push(w);
      if (wheels.indexOf(w) === 1) c.attr = 'gobo2';
      else if (wheels.indexOf(w) > 1) c.attr = 'raw';
      slots++;
    } else if (c.attr === 'goboRotation') {
      const w = wheelOf?.(c);
      const i = w !== undefined ? wheels.indexOf(w) : turns;
      if (i === 1) c.attr = 'gobo2Rotation';
      else if (i > 1) c.attr = 'raw';
      turns++;
    }
  }
  // (a fine byte goes with its coarse one)
  for (let i = 1; i < channels.length; i++) {
    const c = channels[i];
    if (!c.fine) continue;
    const coarse = [...channels.slice(0, i)].reverse().find((x) => !x.fine && (x.attr === c.attr || (c.attr === 'gobo' && x.attr === 'gobo2') || (c.attr === 'goboRotation' && x.attr === 'gobo2Rotation')));
    if (coarse) c.attr = coarse.attr;
  }
}
