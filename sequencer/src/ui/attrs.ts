// What a channel does, in words a user picks from (fixture editor, channel wizard).
import type { ChannelAttr } from '../model/types';

export const ATTR_GROUPS: { label: string; attrs: [ChannelAttr, string][] }[] = [
  { label: 'Light', attrs: [['intensity', 'Dimmer'], ['strobe', 'Strobe (0 = off)'], ['shutter', 'Shutter (open / closed / strobe)']] },
  { label: 'Colour', attrs: [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['white', 'White'], ['warmWhite', 'Warm white'], ['coolWhite', 'Cool white'],
    ['amber', 'Amber'], ['uv', 'UV'], ['lime', 'Lime'], ['cyan', 'Cyan (CMY)'], ['magenta', 'Magenta (CMY)'], ['yellow', 'Yellow (CMY)'],
    ['cct', 'Colour temperature / CTO'], ['colorWheel', 'Colour wheel']] },
  { label: 'Position', attrs: [['pan', 'Pan'], ['tilt', 'Tilt'], ['panRotation', 'Pan rotation (endless)'], ['tiltRotation', 'Tilt rotation (endless)'],
    ['roll', 'Roll (third axis)'], ['rollRotation', 'Roll rotation (endless)'], ['hoist', 'Winch height (0 top, 1 bottom)'], ['speed', 'Movement speed']] },
  { label: 'Beam', attrs: [['gobo', 'Gobo wheel'], ['goboRotation', 'Gobo rotation'], ['gobo2', 'Gobo wheel 2'], ['gobo2Rotation', 'Gobo 2 rotation'],
    ['prism', 'Prism'], ['prismRotation', 'Prism rotation'], ['animation', 'Animation wheel'], ['animationRotation', 'Animation rotation'],
    ['zoom', 'Zoom'], ['focus', 'Focus'], ['iris', 'Iris'], ['frost', 'Frost']] },
  { label: 'Effects', attrs: [['effectMacro', 'Built-in effects (macros)'], ['effectSpeed', 'Effect speed'], ['colorMacro', 'Colour programs (macros)']] },
  { label: 'Atmosphere', attrs: [['fog', 'Fog'], ['haze', 'Haze'], ['fan', 'Fan']] },
  // Effect machines: confetti, flames, sparks and CO2 send 0 until someone holds Arm (model/safety.ts)
  { label: 'Machines', attrs: [['confetti', 'Confetti (fires only while armed)'], ['bubbles', 'Bubbles'], ['flame', 'Flame (fires only while armed)'],
    ['sparks', 'Sparks (fire only while armed)'], ['co2', 'CO2 jet (fires only while armed)'], ['enable', 'Safety / enable (on only while armed)']] },
  { label: 'Other', attrs: [['control', 'Mode / programs / reset (stays at 0: DMX control)'], ['raw', 'Something else (program speed, macros...)']] },
];

export const ATTR_LABEL: Record<string, string> = Object.fromEntries(ATTR_GROUPS.flatMap((g) => g.attrs));
