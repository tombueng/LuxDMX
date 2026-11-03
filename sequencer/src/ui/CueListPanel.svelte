<script lang="ts">
  // A whole cue list on a live page, the way a play is run: every cue with its number, name, fade,
  // what comes next and the standby note; the one on stage lit, the next one marked, kept in view.
  // A cue is jumped to by holding its row (a stray tap in a dark booth mustn't jump the show);
  // Enter on a focused row does it from the keyboard.
  import { app } from '../app.svelte';
  import { cueNumber } from '../model/cuenum';
  import { revealIn } from './reveal';
  import type { Advance, Widget } from '../model/types';

  let { w, editing = false, selected = false, onselect, onmenu }: { w: Widget & { type: 'cuelist' }; editing?: boolean; selected?: boolean; onselect?: (e: MouseEvent) => void; onmenu?: (e: MouseEvent) => void } = $props();

  const HOLD_MS = 600;
  const list = $derived(app.show.cueLists.find((l) => l.id === w.list));
  const st = $derived(list ? app.status[list.id] : undefined);
  const live = $derived(st?.running ? st.index : -1);
  const next = $derived(!list?.cues.length ? -1 : live < 0 ? 0 : live + 1 < list.cues.length ? live + 1 : list.end === 'loop' ? 0 : -1);
  const then = (a: Advance) => a.mode === 'follow' ? (a.time ? `then ${a.time} s` : 'follows') : a.mode === 'wait' ? `auto ${a.time} s` : a.mode === 'beats' ? `${a.beats} beats` : '';

  let rowsEl = $state<HTMLElement>();
  $effect(() => { if (live >= 0 && rowsEl) revealIn(rowsEl, rowsEl.children[live] as HTMLElement); });   // (this list only, not the page)
  // one tab stop: the row on stage (or the first); the arrows move between rows
  const focusAt = $derived(live >= 0 ? live : 0);
  // Space is GO here too (like everywhere on a live page), never "jump to this row": a row keeps
  // the focus after it was held, and every GO would jump back to it first.
  let spaceClick = false;
  function rowKeys(e: KeyboardEvent, i: number) {
    if (!list || editing) return;
    if (e.key === ' ') { spaceClick = true; return; }                    // (the page plays GO; the row's own click is ignored)
    if (e.key === 'Enter') { e.preventDefault(); app.jump(list.id, i); return; }
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? -1e9 : e.key === 'End' ? 1e9 : 0;
    if (!d) return;
    e.preventDefault();
    const to = Math.max(0, Math.min(list.cues.length - 1, i + d));
    (rowsEl?.children[to]?.querySelector('.row') as HTMLElement | null)?.focus();
  }

  let holding = $state(-1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function down(e: PointerEvent, i: number) {
    if (editing || e.button !== 0 || !list) return;
    holding = i;
    clearTimeout(timer);
    timer = setTimeout(() => { holding = -1; try { navigator.vibrate?.(20); } catch { /* fine */ } app.jump(list.id, i); }, HOLD_MS);
  }
  function up() { clearTimeout(timer); holding = -1; }
  $effect(() => () => clearTimeout(timer));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (in edit mode a click selects the panel) -->
<section class="cl" class:editing class:selected aria-label="Cue list {list?.name ?? ''}" onclick={editing ? onselect : undefined}
         oncontextmenu={(e) => { e.preventDefault(); onmenu?.(e); }} onkeydown={() => {}}>
  <header><b>{list?.name ?? '(its list is gone)'}</b><span class="faint">{editing ? 'the cues of this list' : 'hold a cue to jump to it'}</span></header>
  {#if list}
    <ol bind:this={rowsEl}>
      {#each list.cues as c, i (c.id)}
        <li class:live={i === live} class:next={i === next} class:done={live >= 0 && i < live} class:holding={holding === i} style="--hold:{HOLD_MS}ms"
            aria-current={i === live ? 'step' : undefined}>
          <button class="row" tabindex={editing || i !== focusAt ? -1 : 0}
            aria-label="{cueNumber(list, i)}. {c.name}{i === live ? ', on stage' : i === next ? ', next' : ''}{c.note ? `. ${c.note}` : ''}. Hold, or press Enter, to jump to it"
            onpointerdown={(e) => down(e, i)} onpointerup={up} onpointerleave={up} onpointercancel={up}
            onclick={(e) => { if (spaceClick) { spaceClick = false; return; } if (e.detail === 0 && !editing && list) app.jump(list.id, i); }}
            onkeydown={(e) => rowKeys(e, i)}>
          <span class="n">{cueNumber(list, i)}</span>
          <span class="nm">{c.name}{#if i === next}<span class="tag">next</span>{/if}</span>
          <span class="fd">{c.fade} s</span>
          <span class="th">{then(c.advance)}</span>
          {#if c.note}<span class="note">{c.note}</span>{/if}
          </button>
          {#if i === live && st}<span class="prog" style="width:{(st.progress ?? 0) * 100}%"></span>{/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .cl { grid-column: 1 / -1; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); overflow: hidden; }
  .cl.editing { outline: 1px dashed var(--line2); outline-offset: 2px; cursor: pointer; }
  .cl.selected { outline: 2px solid var(--accent); outline-offset: 2px; }
  header { display: flex; align-items: baseline; gap: .6rem; padding: .5rem .8rem; border-bottom: 1px solid var(--line); }
  ol { list-style: none; margin: 0; padding: .25rem; max-height: min(52vh, 520px); overflow: auto; }
  li { position: relative; border-radius: 8px; overflow: hidden; }
  li + li { border-top: 1px solid #ffffff08; }
  .row { width: 100%; display: grid; grid-template-columns: 3.4rem 1fr auto auto; grid-template-areas: 'n nm fd th' 'n note note note'; column-gap: .7rem;
    align-items: baseline; padding: .55rem .6rem; border: 0; background: none; text-align: left; color: inherit; font: inherit; border-radius: 8px;
    user-select: none; touch-action: pan-y; cursor: default; min-height: 0; }
  .row:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .n { grid-area: n; font: 700 1.05rem ui-monospace, monospace; color: var(--muted); font-variant-numeric: tabular-nums; }
  .nm { grid-area: nm; font-weight: 650; font-size: 1.02rem; }
  .fd { grid-area: fd; color: var(--muted); font-variant-numeric: tabular-nums; font-size: .85rem; }
  .th { grid-area: th; color: var(--cyan); font-size: .8rem; }
  .note { grid-area: note; color: var(--orange); font-size: .9rem; margin-top: .15rem; }
  .tag { margin-left: .5rem; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--green); border: 1px solid var(--green); border-radius: 999px; padding: 0 .4rem; vertical-align: .1em; }
  li.live { background: color-mix(in srgb, var(--green) 16%, transparent); box-shadow: inset 4px 0 0 var(--green); }
  li.live .n, li.live .nm { color: var(--text); }
  li.next { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--green) 45%, transparent); }
  li.done { opacity: .55; }
  .prog { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--green); }
  /* holding a row: it fills up, and jumps when full */
  li.holding::after { content: ''; position: absolute; inset: 0; background: color-mix(in srgb, var(--orange) 22%, transparent); transform-origin: left; animation: fill var(--hold) linear forwards; pointer-events: none; }
  @keyframes fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @media (max-width: 560px) { .row { grid-template-columns: 2.6rem 1fr auto; grid-template-areas: 'n nm fd' 'n note note'; } .th { display: none; } }
</style>
