// What the selection is and can do, as the programmer and the console's encoders both show it: the
// lights picked (in the show's order), every attribute at least one of them has, and for a channel
// of named slots (a gobo wheel, built-in effects, colour programs) the first picked light that has
// one. Worked out once for both, not once in each.
import { app } from '../app.svelte';
import { slotsOf } from '../engine/render';
import type { ChannelAttr } from '../model/types';

class Selection {
  fixtures = $derived(app.show.fixtures.filter((f) => app.selected.includes(f.id)));
  attrs = $derived.by(() => {
    const a = new Set<ChannelAttr>();
    for (const f of this.fixtures) for (const c of app.modeOf(f.id)?.channels ?? []) a.add(c.attr);
    return a;
  });
  has = (...k: ChannelAttr[]) => k.some((x) => this.attrs.has(x));
  // the first picked light with slots on `k`: which light, and its slots
  slots(k: ChannelAttr) {
    for (const f of this.fixtures) {
      const c = app.modeOf(f.id)?.channels.find((x) => x.attr === k && !x.fine);
      const slots = c ? slotsOf(c) : [];
      if (slots.length) return { id: f.id, slots };
    }
    return undefined;
  }
}
export const selection = new Selection();
