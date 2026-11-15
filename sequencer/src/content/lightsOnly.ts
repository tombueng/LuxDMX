// "Lights only" on the welcome: a template's or a demo's rig with nothing programmed. The patch,
// where each light is (2D and 3D), the groups, the palettes (colours, positions: they help program,
// they play nothing) and the room stay; the cues, effects, live pages, song and set list go.
import type { Show } from '../model/types';

export function lightsOnly(s: Show): Show {
  const { timeline: _t, setlist: _s, ...rest } = s;
  return { ...rest, meta: { ...s.meta, name: `${s.meta.name} (lights only)` }, cueLists: [], effects: [], pages: [] };
}
