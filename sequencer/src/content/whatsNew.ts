// A live page someone made their own stops following the show: a list, an effect or a group made
// later isn't on it. This finds those (what the generated page would have for them, that no page
// plays yet) so they can be added in one go, keys and MIDI on the rest left alone. Specials and
// faders are never brought back: one that isn't there was taken off on purpose.
import type { Page, Show, Widget } from '../model/types';
import { buskingPage } from './busking';

// what a control plays, for "is it on a page already"
function target(w: Widget): string | undefined {
  switch (w.type) {
    case 'list': case 'cuelist': return `list:${w.list}`;
    case 'cue': return `cue:${w.cue}`;
    case 'effect': return `effect:${w.effect}`;
    case 'group': return `group:${w.group}`;
    case 'fog': return `fog:${[...w.fixtures].sort().join()}`;
    default: return undefined;
  }
}

export function whatsNew(show: Show, pages: Page[]): Widget[] {
  const have = new Set<string>();
  for (const p of pages) for (const w of p.widgets) {
    const t = target(w);
    if (t) have.add(t);
    // a list played as a whole or by its cues counts for its cues too
    if (w.type === 'cuelist' || w.type === 'list') for (const c of show.cueLists.find((l) => l.id === w.list)?.cues ?? []) have.add(`cue:${c.id}`);
    if (w.type === 'cue') have.add(`list:${w.list}`);
  }
  // fog: any fog button with any of those machines counts
  const fogged = new Set(pages.flatMap((p) => p.widgets.flatMap((w) => (w.type === 'fog' ? w.fixtures : []))));
  return buskingPage(show).widgets.filter((w) => {
    const t = target(w);
    if (!t || have.has(t)) return false;
    if (w.type === 'fog') return !w.fixtures.some((id) => fogged.has(id));
    return true;
  });
}
