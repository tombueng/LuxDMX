<script lang="ts">
  // A live control as drawn and touched: the tile from its face (see widgetFace.ts), and what a
  // press, a hold, a tap or a fader drag means. It doesn't know the show: the live page passes the
  // app's actions in, a phone used as a remote passes in "send this to the laptop".
  import { svgImage } from './thumb';
  import EffectPreview from './EffectPreview.svelte';
  import Icon from './Icon.svelte';
  import type { Face } from './widgetFace';

  let { face, pic = '', swatch, editing = false, selected = false, onfire, onfader, faderNow, onburst, onselect, onmenu }: {
    face: Face; pic?: string; swatch?: string[]; editing?: boolean; selected?: boolean;
    onfire: (down: boolean) => void;           // press (true) and release (false)
    onfader?: (v: number) => void; faderNow?: () => number; onburst?: () => void;
    onselect?: (e: MouseEvent) => void; onmenu?: (e: MouseEvent) => void;
  } = $props();

  const fval = $derived(face.fader?.v ?? 0);
  const current = () => faderNow?.() ?? fval;
  // Relative dragging (like a real fader knob): the value follows the pointer from where you grab.
  // A finger has to hold still for a moment first (the tile lights up and ticks): a quick swipe over
  // a fader scrolls the page instead of pulling the master down by accident.
  let fading: { y: number; v: number; h: number } | null = null;
  let grabbed = $state(false);
  const touchy = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  let arming: { y: number; t: ReturnType<typeof setTimeout> } | null = null;
  function faderDown(e: PointerEvent) {
    if (editing || face.missing || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const grab = (y: number) => { fading = { y, v: current(), h: el.getBoundingClientRect().height }; grabbed = true; };
    if (e.pointerType === 'touch') {
      const y = e.clientY;
      arming = { y, t: setTimeout(() => { arming = null; grab(y); buzz(); }, 180) };
      return;
    }
    el.setPointerCapture(e.pointerId);
    grab(e.clientY);
  }
  function faderMove(e: PointerEvent) {
    if (arming && Math.abs(e.clientY - arming.y) > 8) { clearTimeout(arming.t); arming = null; }   // a swipe: the page scrolls
    if (fading) onfader?.(Math.max(0, Math.min(1, fading.v + (fading.y - e.clientY) / Math.max(40, fading.h))));
  }
  function faderUp() { if (arming) clearTimeout(arming.t); arming = null; fading = null; grabbed = false; }
  // Once grabbed, the finger's moves are the fader's, not the page's.
  function holdScroll(node: HTMLElement) {
    const stop = (e: TouchEvent) => { if (grabbed && e.cancelable) e.preventDefault(); };
    node.addEventListener('touchmove', stop, { passive: false });
    return { destroy: () => node.removeEventListener('touchmove', stop) };
  }
  function faderKey(e: KeyboardEvent) {
    const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.25, PageDown: -0.25, Home: -1, End: 1 }[e.key];
    if (d === undefined || editing) return;
    e.preventDefault(); e.stopPropagation();
    onfader?.(Math.max(0, Math.min(1, current() + d)));
  }

  let pressed = $state(false);
  // removed while touched (a page switched, the tile deleted): nothing may fire later, what's held lets go
  $effect(() => () => {
    if (settle) { clearTimeout(settle.t); settle = null; }
    if (arming) { clearTimeout(arming.t); arming = null; }
    if (pressed) onfire(false);
  });
  // Buttons that work while held (flash, fog) act on press. The others act on a finger only when
  // it lifts without having moved, so scrolling the page never fires a look by accident.
  let tap: { x: number; y: number; id: number } | null = null;
  let lastPointer = 'mouse';                 // a long press with a finger is a hold, never a menu
  // A finger on a hold button (flash, fog, drop) fires once it has stayed put for a moment: a
  // scroll that happens to start on one mustn't flash the room.
  let settle: { x: number; y: number; t: ReturnType<typeof setTimeout> } | null = null;
  function down(e: PointerEvent) {
    if (editing) return;
    if (e.button !== 0) return;
    if (e.pointerType !== 'mouse' && !face.holds) { tap = { x: e.clientX, y: e.clientY, id: e.pointerId }; return; }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (e.pointerType === 'touch') {
      settle = { x: e.clientX, y: e.clientY, t: setTimeout(() => { settle = null; pressed = true; buzz(); onfire(true); }, 90) };
      return;
    }
    pressed = true;
    onfire(true);
  }
  function settleMove(e: PointerEvent) { if (settle && Math.hypot(e.clientX - settle.x, e.clientY - settle.y) > 8) { clearTimeout(settle.t); settle = null; } }
  // A finger lifted before the hold began: a short flash (press, and let go a moment later), so a
  // quick tap on a flash button still shows.
  function settleUp() {
    if (!settle) return;
    clearTimeout(settle.t); settle = null;
    onfire(true);
    setTimeout(() => onfire(false), BLIP_MS);
  }
  const BLIP_MS = 150;
  // A short tick under the finger (phones and tablets that can; nothing elsewhere).
  const buzz = () => { try { navigator.vibrate?.(8); } catch { /* not allowed */ } };
  function tapUp(e: PointerEvent) {
    const t = tap;
    tap = null;
    if (!t || t.id !== e.pointerId || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 12) return;
    buzz();
    onfire(true); onfire(false);
  }
  // Keyboard: Enter presses the focused button (and holds it while held). Space stays GO, always.
  function key(e: KeyboardEvent, isDown: boolean) {
    if (editing || e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    if (isDown && !e.repeat && !pressed) { pressed = true; onfire(true); }
    else if (!isDown && pressed) { pressed = false; onfire(false); }
  }
  function up() {
    if (!pressed) return;
    pressed = false;
    onfire(false);
  }
</script>

{#if face.type === 'label'}
  <div class="head" class:editing class:selected style="--c:{face.color}" role="button" tabindex="-1" onclick={onselect} onkeydown={() => {}}>
    <span>{face.label}</span>
  </div>
{:else if face.type === 'fader'}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (only clickable in edit mode, to select it) -->
  <!-- The whole tile is the fader: drag up and down anywhere on it (mouse or finger), or use the arrow keys. -->
  <div class="tile fader" class:editing class:selected class:missing={face.missing || face.inert} class:inert={face.inert} style="--c:{face.color};--v:{fval}" role="slider" tabindex="0" data-widget={face.id}
       aria-label="{face.label} level{face.inert ? ' (not while locked)' : ''}" aria-disabled={face.inert || undefined} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fval * 100)}
       onclick={editing ? onselect : undefined} oncontextmenu={(e) => { e.preventDefault(); onmenu?.(e); }}
       onpointerdown={faderDown} onpointermove={faderMove} onpointerup={faderUp} onpointercancel={faderUp} use:holdScroll class:grabbed
       onkeydown={faderKey}>
    <span class="fill"></span>
    <span class="t">{face.label}</span>
    <b>{face.fader?.text ?? ''}</b>
    {#if face.inert}<span class="sub">not while locked</span>{:else if touchy && !editing}<span class="sub">{grabbed ? 'drag' : 'hold, then drag'}</span>{/if}
  </div>
{:else}
  <button class="tile {face.type}" class:on={face.on} class:pressed class:editing class:selected class:missing={face.missing || face.inert} class:inert={face.inert} class:wide={face.wide}
          style="--c:{face.color}" aria-pressed={face.on} aria-disabled={face.inert || undefined} data-widget={face.id}
          onpointerdown={down} onpointermove={settleMove} onpointerup={(e) => { settleUp(); tapUp(e); up(); }} onpointercancel={() => { tap = null; if (settle) { clearTimeout(settle.t); settle = null; } up(); }} onlostpointercapture={up}
          onkeydown={(e) => key(e, true)} onkeyup={(e) => key(e, false)} data-no-longpress={!editing || undefined}
          onclick={(e) => { if (editing) onselect?.(e); }} oncontextmenu={(e) => { e.preventDefault(); if (editing || lastPointer === 'mouse') onmenu?.(e); }}
          onpointerenter={(e) => (lastPointer = e.pointerType)}>
    {#if face.glyph}<span class="glyph"><Icon name={face.glyph} size={18} /></span>{/if}
    {#if face.type === 'cue' && pic}
      <span class="pic"><img src={svgImage(pic)} alt="" draggable="false" /></span>
    {:else if face.type === 'cue' && swatch?.length}
      <span class="pic swatch" style="background:{swatch.length > 1 ? `linear-gradient(90deg, ${swatch.join(', ')})` : swatch[0]}"></span>
    {:else if face.type === 'effect' && face.fx}
      <span class="pic fxp"><EffectPreview kind={face.fx.kind} params={face.fx.params} w={130} h={34} bpm={face.fx.bpm} paused={!face.on} /></span>
    {/if}
    <span class="t">{face.label}</span>
    {#if face.sub}<span class="sub">{face.sub}</span>{/if}
    {#if face.bar !== undefined}<span class="bar"><span style="width:{Math.max(0, Math.min(1, face.bar)) * 100}%"></span></span>{/if}
    {#if face.risk === 'hazard'}<span class="risk hazard" title="Fires a machine (flames, sparks or CO2): only while armed"><Icon name="warn" size={12} /><span class="sr">fires a machine</span></span>
    {:else if face.risk === 'once'}<span class="risk once" title="Fires confetti (once): only while armed">1×<span class="sr">fires once</span></span>{/if}
    {#if face.key}<span class="key">{face.key}</span>{/if}
  </button>
  <!-- A short burst without holding: its own button next to the tile, not inside it. -->
  {#if face.burst && !editing}
    <button class="burst" style="--c:{face.color}" title="Fog for {face.burst} s" aria-label="Fog for {face.burst} seconds"
      onclick={() => onburst?.()}>{face.burst} s</button>
  {/if}
{/if}

<style>
  .tile { position: relative; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; gap: .15rem; min-height: max(92px, 6.6rem); padding: .5rem .55rem;
    border-radius: 12px; border: 1px solid var(--line); background: linear-gradient(180deg, var(--panel2), var(--panel)); text-align: left; white-space: normal;
    box-shadow: inset 0 3px 0 color-mix(in srgb, var(--c) 70%, transparent); user-select: none; touch-action: manipulation; overflow: hidden; }
  .tile:hover:not(:disabled) { border-color: var(--line2); }
  .tile.wide { grid-column: span 2; }
  .tile.on { color: var(--text); border-color: var(--c); background: linear-gradient(180deg, color-mix(in srgb, var(--c) 28%, var(--panel2)), color-mix(in srgb, var(--c) 10%, var(--panel))); box-shadow: 0 0 18px color-mix(in srgb, var(--c) 35%, transparent), inset 0 3px 0 var(--c); }
  .tile.pressed { transform: scale(.97); }
  .tile.missing { opacity: .5; }
  .tile.editing { outline: 1px dashed var(--line2); outline-offset: 2px; cursor: pointer; }
  .tile.editing:focus-visible { outline: 2px solid var(--focus); }
  .tile.selected, .head.selected { outline: 2px solid var(--accent); outline-offset: 2px; }
  .t { font-weight: 700; font-size: .95rem; line-height: 1.15; }
  /* bigger text grows the tile instead of running the label under the icon or the key */
  .tile:has(> .glyph) { padding-top: 2.1rem; }
  .tile.cue:has(> .key) .t, .tile.effect:has(> .key) .t { padding-right: 1.7rem; }
  .sub { font-size: .76rem; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
  /* The picture takes the room above the label (never under it, whatever the tile size). */
  .tile.cue, .tile.effect { justify-content: flex-start; padding-top: .4rem; }
  .pic { width: 100%; flex: 1; min-height: 30px; max-height: 120px; border-radius: 7px; overflow: hidden; opacity: .95; }
  .pic img { width: 100%; height: 100%; display: block; object-fit: contain; }
  .swatch { min-height: 40px; box-shadow: inset 0 0 0 1px #0006; }
  .fxp { display: flex; justify-content: center; align-items: center; } .fxp :global(canvas) { background: transparent; }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: #ffffff10; }
  .bar span { display: block; height: 100%; background: var(--c); }
  .glyph { position: absolute; top: .5rem; left: .55rem; color: color-mix(in srgb, var(--c) 80%, var(--muted)); opacity: .9; display: flex; }
  .tile.on .glyph { color: var(--text); }
  .burst { position: absolute; right: .4rem; bottom: .4rem; font-size: .76rem; padding: .1rem .45rem; border-radius: 999px; border: 1px solid var(--line2); color: var(--muted); background: var(--panel); }
  .burst:hover { color: var(--text); border-color: var(--c); }
  .risk { position: absolute; top: .3rem; right: .35rem; display: inline-flex; align-items: center; font: 700 .72rem ui-monospace, monospace; color: var(--orange); background: #000a; border-radius: 4px; padding: .05rem .2rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .key { position: absolute; top: .35rem; right: .4rem; font: 600 .76rem ui-monospace, monospace; color: var(--faint); border: 1px solid var(--line2); border-radius: 4px; padding: 0 .25rem; }
  /* tiles with a picture: the key goes down by the name, the picture stays clean */
  .tile.cue .key, .tile.effect .key { top: auto; bottom: .45rem; }
  .tile:not(.cue):not(.effect) .risk + .key { top: 1.6rem; }      /* (under the mark) */
  /* nobody has a keyboard on a phone or tablet */
  @media (pointer: coarse) and (hover: none) { .key { display: none; } }
  .fader { justify-content: flex-end; cursor: ns-resize; touch-action: pan-y; }
  .fader.grabbed { box-shadow: inset 0 0 0 2px var(--c), 0 0 18px color-mix(in srgb, var(--c) 45%, transparent); }
  .fader .fill { position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--v) * 100%); background: linear-gradient(0deg, color-mix(in srgb, var(--c) 45%, transparent), color-mix(in srgb, var(--c) 18%, transparent)); border-top: 2px solid var(--c); pointer-events: none; }
  .fader .t, .fader b { position: relative; }
  .fader b { font-size: .85rem; }
  .fader.editing { cursor: pointer; }
  .head { grid-column: 1 / -1; font-size: .76rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); padding: .7rem .1rem .1rem; display: flex; align-items: center; gap: .5rem; }
  .head::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .head.editing { outline: 1px dashed var(--line2); cursor: pointer; }
  .special.on { --c: var(--pink); }
  /* the set list's buttons: the song's name and where it is, readable from a mic stand */
  .tile.song .t { font-size: 1.15rem; }
  .tile.song .sub { text-transform: none; letter-spacing: 0; font-size: .92rem; color: var(--text); opacity: .85; font-variant-numeric: tabular-nums; }
  /* a master on a locked page: there, but switched off (no colour, no grab) */
  .tile.inert { filter: saturate(0); opacity: .42; cursor: not-allowed; }
</style>
