<script lang="ts">
  // One live control: a cue list button, a scene, an effect, a fader, fog, or a special button.
  // Its face comes from widgetFace(), the touching from TileFace; here they meet the app.
  // Press and release go to the app separately so flash and fog work on touch screens too.
  import TileFace from './TileFace.svelte';
  import CueListPanel from './CueListPanel.svelte';
  import { app } from '../app.svelte';
  import { placesOf } from '../model/pixelLayout';
  import { stageSvg } from './thumb';
  import type { Widget } from '../model/types';
  import { clock } from './clock.svelte';
  import { faderValue, widgetFace, type Face } from './widgetFace';
  import { viewShown } from './shown.svelte';

  let { w, editing = false, selected = false, manyLists = false, onselect, onmenu }: { w: Widget; editing?: boolean; selected?: boolean; manyLists?: boolean; onselect?: (e: MouseEvent) => void; onmenu?: (e: MouseEvent) => void } = $props();

  const fogging = $derived(w.type === 'fog' && !!app.fogUntil[w.id]);
  // the fog countdown ticks along while it runs; the same face as last time is the same object, so
  // a tile whose looks didn't change doesn't redraw on every clock tick
  // (Live hidden behind another view: the face stays as it was, it's worked out again when shown)
  const shown = viewShown();
  let last: Face | undefined;
  const face = $derived.by(() => {
    if (!shown() && last) return last;
    if (fogging) void clock.t;
    const f = widgetFace(app, w, manyLists);
    if (last && JSON.stringify(last) === JSON.stringify(f)) return last;
    return (last = f);
  });
  $effect(() => { if (fogging) return clock.use(); });
  const thumb = $derived.by(() => {
    if (w.type !== 'cue') return '';
    const list = app.show.cueLists.find((l) => l.id === w.list);
    const i = list ? list.cues.findIndex((c) => c.id === w.cue) : -1;
    const look = i >= 0 ? app.cueLooksOf.get(w.list)?.[i] : undefined;
    return look ? stageSvg(app.plain?.fixtures ?? [], look, app.kinds, 160, 80, false, (id) => placesOf(app.modeOf(id))) : '';
  });
</script>

{#if w.type === 'cuelist'}
  <CueListPanel {w} {editing} {selected} {onselect} {onmenu} />
{:else}
<TileFace {face} pic={thumb} {editing} {selected} {onselect} {onmenu}
  onfire={(down) => app.fireWidget(w, down)}
  onfader={(v) => app.setFader(w, v)} faderNow={() => faderValue(app, w, true)}
  onburst={() => { if (w.type === 'fog') app.fogBurst(w); }} />
{/if}
