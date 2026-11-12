<script lang="ts">
  import GoboIcon from './GoboIcon.svelte';
  import { CCW_WORDS, wheelPatterns } from '../stage3d/gobos';
  import { levelOf } from '../engine/cuelook';
  import { tick } from 'svelte';
  import ValueEdit from './ValueEdit.svelte';
  // The programmer: set the selected lights. Only controls the selection can use show up. What you
  // set here sits on top of everything until you Record it into a cue (or Clear it).
  import Icon from './Icon.svelte';
  import Help from './Help.svelte';
  import Channels from './Channels.svelte';
  import CellPicker from './CellPicker.svelte';
  import { cellLookAt } from '../engine/resolve';
  import ColorWheel from './ColorWheel.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import type { ChannelAttr, Color, NumAttr, Values } from '../model/types';
  import { EFFECT_MAP } from '../engine/effects';
  import { slotsOf } from '../engine/render';

  const sel = $derived(app.show.fixtures.filter((f) => app.selected.includes(f.id)));
  // Every attribute at least one selected light has.
  const attrs = $derived.by(() => {
    const a = new Set<ChannelAttr>();
    for (const f of sel) for (const c of app.modeOf(f.id)?.channels ?? []) a.add(c.attr);
    return a;
  });
  const has = (...k: ChannelAttr[]) => k.some((x) => attrs.has(x));
  const can = $derived({
    color: has('red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'colorWheel'),
    position: has('pan', 'tilt'),
  });
  // what the controls show: the first selected light, or its first picked cell
  const first = $derived.by(() => {
    if (!sel.length) return undefined;
    return app.lookFor(sel[0].id);
  });
  const cellLights = $derived(sel.filter((f) => app.caps(f.id).cells > 1));
  const pickedCells = $derived(sel.reduce((a, f) => a + app.cellsPicked(f.id).length, 0));
  // Something in the selection makes light (a fog machine alone doesn't: no Intensity for it).
  const hasLight = $derived(has('intensity', 'red', 'green', 'blue', 'white', 'amber', 'uv', 'cyan', 'magenta', 'yellow', 'colorWheel', 'cct', 'warmWhite', 'coolWhite'));
  const changed = $derived(Object.keys(app.programmer).length);
  const jumps = $derived([
    ...(cellLights.length ? [['pg-cells', 'Cells']] : []), ...(hasLight ? [['pg-int', 'Intensity']] : []), ...(can.color ? [['pg-col', 'Colour']] : []),
    ...(can.position ? [['pg-pos', 'Position']] : []), ['pg-all', 'Channels'],
  ] as [string, string][]);
  // where the programmer is scrolled to (the chip for it lights up); Channels opens the list too
  let here = $state('');
  async function jump(id: string) {
    // the list draws once the details has told Svelte it opened (its toggle event comes a moment later)
    if (id === 'pg-all') {
      const d = document.getElementById('pg-all-ch') as HTMLDetailsElement | null;
      if (d && !d.open) { const opened = new Promise((r) => d.addEventListener('toggle', r, { once: true })); d.open = true; await opened; await tick(); }
    }
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  // the part whose top has passed the top of the scrolled panel (the last one at the very bottom)
  let jumpBar = $state<HTMLElement>();
  $effect(() => {
    const ids = jumps.map(([id]) => id);
    let box: HTMLElement | null = jumpBar?.parentElement ?? null;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!box) return;
    const scroller = box;
    const spy = () => {
      const top = scroller.getBoundingClientRect().top + (jumpBar?.offsetHeight ?? 0) + 24;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      let cur = ids[0];
      for (const id of ids) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top <= top) cur = id; }
      here = atEnd && scroller.scrollTop > 0 ? ids[ids.length - 1] : cur;
    };
    spy();
    scroller.addEventListener('scroll', spy, { passive: true });
    return () => scroller.removeEventListener('scroll', spy);
  });
  const playing = $derived(app.show.cueLists.filter((l) => app.status[l.id]?.running && !app.status[l.id]?.releasing));
  // Effects running on the selection (what you see on stage may be them, not the values here).
  const running = $derived(app.effectsOn(sel.map((f) => f.id)));
  // (a pixel bar: its brightest cell, a pixel chase lights it at intensity 0)
  // (picked cells: the first one's)
  const out = $derived.by(() => { if (!sel.length) return undefined; const s = app.stage[sel[0].id], k = app.cellsPicked(sel[0].id)[0]; return k === undefined ? levelOf(s) : cellLookAt(s, k, app.caps(sel[0].id).cells)?.intensity ?? 0; });
  const CAT: Record<string, string> = { move: 'position', color: 'colour', intensity: 'brightness' };
  const presets = $derived(app.show.presets);
  const colorPresets = $derived(presets.filter((p) => p.kind === 'color'));
  // Whites: what a warm/cool white fixture can take from the colour presets.
  const isWhitish = (c: unknown) => { const x = c as Color | undefined; if (!x || 'preset' in (x as object)) return false; const max = Math.max(x.r, x.g, x.b) || 1; return (max - Math.min(x.r, x.g, x.b)) / max < 0.6; };
  const whitePresets = $derived(colorPresets.filter((p) => isWhitish(p.values.color)));
  // Lights in the selection that can't mix colours (warm/cool whites, plain dimmers).
  const noColor = $derived(sel.filter((f) => { const c = app.caps(f.id); return !c.color && !c.fog && (c.intensity || c.cct || c.white); }));
  const posPresets = $derived(presets.filter((p) => p.kind === 'position'));
  // (picked cells: every one of them uses it)
  const usesPreset = (id: string) => app.usesPreset(id);

  const css = (c: Color) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  const pct = (v: number | undefined) => Math.round((v ?? 0) * 100);
  const setNum = (k: NumAttr) => (e: Event) => app.set({ [k]: +(e.target as HTMLInputElement).value } as Values);
  const SLIDERS: [NumAttr, string, ChannelAttr[]][] = [
    ['white', 'White', ['white']], ['amber', 'Amber', ['amber']], ['uv', 'UV', ['uv']],
    ['cct', 'Colour temperature', ['cct', 'warmWhite', 'coolWhite']], ['strobe', 'Strobe', ['strobe', 'shutter']],
    ['zoom', 'Zoom', ['zoom']], ['focus', 'Focus', ['focus']], ['iris', 'Iris', ['iris']], ['frost', 'Frost', ['frost']],
    ['prism', 'Prism', ['prism']], ['prismRotation', 'Prism rotation', ['prismRotation']], ['goboRotation', 'Gobo rotation', ['goboRotation']],
    ['gobo2Rotation', 'Gobo 2 rotation', ['gobo2Rotation']], ['animation', 'Animation wheel', ['animation']], ['animationRotation', 'Animation rotation', ['animationRotation']],
    ['effectSpeed', 'Effect speed', ['effectSpeed']],
    ['panRotation', 'Pan rotation (endless)', ['panRotation']], ['tiltRotation', 'Tilt rotation (endless)', ['tiltRotation']],
    ['roll', 'Roll (third axis)', ['roll']], ['rollRotation', 'Roll rotation (endless)', ['rollRotation']],
    ['hoist', 'Winch height (moves only armed)', ['hoist']],
    ['fog', 'Fog', ['fog']], ['haze', 'Haze', ['haze']], ['fan', 'Fan', ['fan']], ['speed', 'Move speed', ['speed']],
    ['confetti', 'Confetti (fires past 50 %)', ['confetti']], ['bubbles', 'Bubbles', ['bubbles']], ['flame', 'Flame', ['flame']], ['sparks', 'Sparks', ['sparks']], ['co2', 'CO2', ['co2']],
  ];
  // Picked by name: a gobo, a second gobo, the light's built-in effects, its colour programs (from
  // the first selected light that has them; app.setSlot finds the same name on the others).
  const PICKS: ['gobo' | 'gobo2' | 'effectMacro' | 'colorMacro', string][] = [['gobo', 'Gobo'], ['gobo2', 'Gobo 2'], ['effectMacro', 'Built-in effect'], ['colorMacro', 'Colour program']];
  const picks = $derived(PICKS.flatMap(([k, label]) => {
    for (const f of sel) {
      const c = app.modeOf(f.id)?.channels.find((x) => x.attr === k && !x.fine);
      const slots = c ? slotsOf(c) : [];
      if (slots.length) {
        const v = app.look[f.id]?.[k];
        const cur = typeof v === 'number' ? Math.round(v * (slots.length - 1)) : -1;
        return [{ k, label, slots: slots.map((r) => r.label), colors: slots.map((r) => r.color), cur, wheel: wheelExtras(f.id, k) }];
      }
    }
    return [];
  }));
  // A gobo wheel's own functions, as real heads have them on its channel's other ranges: the gobo
  // shaking ("Shake 3 slow..fast") and the whole wheel running round ("Wheel rotation CW / CCW").
  // Attributes like any other (goboShake, goboScroll: a cue keeps them, the next one lets them go).
  function wheelExtras(id: string, k: string) {
    if (k !== 'gobo' && k !== 'gobo2') return undefined;
    const c = app.modeOf(id)?.channels.find((x) => x.attr === k && !x.fine && x.cell === undefined);
    const others = c?.ranges?.filter((r) => r.kind === 'other') ?? [];
    const shakes = others.filter((r) => /shake|wackel|zitter/i.test(r.label ?? ''));
    const runs = others.filter((r) => /rotat|scroll|spin|dreh/i.test(r.label ?? '') && !/shake/i.test(r.label ?? ''));
    if (!shakes.length && !runs.length) return undefined;
    const look = app.look[id] as Record<string, number | undefined> | undefined;
    return { shakes, cw: runs.some((r) => !CCW_WORDS.test(r.label ?? '')), ccw: runs.some((r) => CCW_WORDS.test(r.label ?? '')),
      shaking: (look?.[`${k}Shake`] ?? 0) > 0, scroll: look?.[`${k}Scroll`] ?? 0 };
  }
  // A slider's channel with named ranges (a prism's facets, a rotation's index / CW / stop / CCW): its
  // ranges, from the first selected light that has it (a plain channel: none)
  function rangesOf(k: string) {
    for (const f of sel) {
      const c = app.modeOf(f.id)?.channels.find((x) => x.attr === k && !x.fine && x.cell === undefined);
      if (c) return c.ranges && c.ranges.length > 1 && !c.span ? c.ranges.filter((r) => r.label) : undefined;
    }
    return undefined;
  }
  const inByte = (v: number | undefined, r: { from: number; to: number }) => typeof v === 'number' && Math.round(v * 255) >= r.from && Math.round(v * 255) <= r.to;

  const valueLabel = (k: NumAttr, v: number | undefined) =>
    k === 'strobe' ? (v ? `${pct(v)}%` : 'off') : k === 'cct' ? ((v ?? 0.5) < 0.4 ? 'warm' : (v ?? 0.5) > 0.6 ? 'cool' : 'neutral') : `${pct(v)}%`;

  let pad = $state<HTMLDivElement>();
  let gradA = $state('#ff0000'), gradB = $state('#0000ff');
  const fromHex = (h: string): Color => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
  function aim(e: PointerEvent) {
    if (!pad) return;
    if (e.type === 'pointerdown') pad.setPointerCapture(e.pointerId);
    else if (!(e.buttons & 1)) return;
    const r = pad.getBoundingClientRect();
    app.set({ pan: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), tilt: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) });
  }
  function padKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.05 : 0.005;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!d[e.key]) return;
    e.preventDefault();
    for (const f of sel) {
      const l = app.look[f.id];
      app.programmer[f.id] = { ...app.programmer[f.id], pan: Math.max(0, Math.min(1, (l?.pan ?? 0.5) + d[e.key][0])), tilt: Math.max(0, Math.min(1, (l?.tilt ?? 0.5) + d[e.key][1])) };
    }
  }
  function record() { ui.toast(app.record() ? 'Recorded as a new cue' : 'Nothing to record yet'); }
</script>

<div class="panel prog" data-marks="hide">
  <div class="row head">
    <h2>Programmer</h2>
    {#if sel.length}<span class="chip orange">{sel.length} selected{pickedCells ? `, ${pickedCells} cell${pickedCells > 1 ? 's' : ''}` : ''}</span>{/if}
    <span class="grow"></span>
    <button class="ghost hl" class:on={app.highlight} onclick={() => (app.highlight = !app.highlight)} disabled={!sel.length && !app.highlight}
            title="Highlight: the selected lights go full white so you can find them in the room (not recorded)" aria-label="Highlight" aria-pressed={app.highlight}><Icon name="sun" size={15} /></button>
    <Help>
      <p>Set the <b>selected</b> lights here. Only the controls they can use show up.</p>
      <p>Everything you change stays on top of the cues until you <b>Record</b> it (then it's in the cue) or <b>Clear</b> it (then the cues take over again). Lights you touched are marked in the fixture list.</p>
      <p>Keys: arrows move a head on the position pad (Shift for big steps).</p>
    </Help>
  </div>

  {#if sel.length === 0}
    <div class="empty">
      {#if !app.show.fixtures.length}
      <p class="faint">Lights you select are set here: brightness, colour, position.</p>
      {:else}
      <p>Select lights on the stage or in the fixture list, then set them here.</p>
      {#if app.show.groups.length}
        <div class="quick" aria-label="Select a group">
          {#each app.show.groups as g (g.id)}<button class="sm" onclick={() => app.selectGroup(g.id)} title="Select {g.name}">{g.name}</button>{/each}
          <button class="sm ghost" onclick={() => app.selectAll()}>All</button>
        </div>
      {/if}
      {/if}
    </div>
    <!-- Nothing selected: what's going on right now, with a way to stop each of it. -->
    {#if playing.length || app.liveFx.length || changed}
      <section class="now" aria-label="Playing now">
        <h3 class="faint">Playing now</h3>
        {#each playing as l (l.id)}
          {@const st = app.status[l.id]}
          <div class="pl" style="--c:{l.color ?? 'var(--green)'}">
            <span class="dot"></span>
            <span class="nm"><b>{l.name}</b> <span class="faint">{l.cues[st.index]?.name ?? ''}</span></span>
            <input type="range" min="0" max="1" step="0.01" value={st.master} oninput={(e) => app.setMaster(l.id, +(e.target as HTMLInputElement).value)} aria-label="{l.name} level" title="Level {Math.round(st.master * 100)}%" />
            <button class="sm" onclick={() => app.release(l.id)} title="Fade {l.name} out">Release</button>
          </div>
        {/each}
        {#each app.liveFx as id (id)}
          {@const e = app.show.effects.find((x) => x.id === id)}
          {#if e}<div class="pl fx"><Icon name="effect" size={14} /><span class="nm">{e.name} <span class="faint">by hand</span></span>
            <button class="sm" onclick={() => app.toggleEffect(id)}>Stop</button></div>{/if}
        {/each}
        {#if changed}
          <div class="pl prg"><Icon name="edit" size={14} /><span class="nm">{changed} light{changed > 1 ? 's' : ''} changed, not recorded</span>
            <button class="sm" onclick={() => app.clearProgrammer()} title="Let go of your changes: the cues take over again">Clear</button></div>
        {/if}
      </section>
    {/if}
  {:else}
    <div class="names faint">{sel.slice(0, 6).map((f) => f.name).join(', ')}{sel.length > 6 ? ` and ${sel.length - 6} more` : ''}</div>
    <!-- jump to a part (a head's position pad is otherwise a long scroll down) -->
    {#if jumps.length > 2}
      <div class="jump" role="navigation" aria-label="Programmer parts" bind:this={jumpBar}>
        {#each jumps as [id, label] (id)}<button class="sm" class:cur={here === id} aria-current={here === id ? 'true' : undefined} onclick={() => jump(id)}>{label}</button>{/each}
      </div>
    {/if}
    {#if running.length}
      <div class="fxnote">
        <Icon name="effect" size={14} />
        <span>{running.map((e) => `${e.name} (${CAT[EFFECT_MAP.get(e.kind)?.category ?? 'intensity']})`).join(', ')} {running.length > 1 ? 'are' : 'is'} running on these lights, on top of what you set here.</span>
        {#each running.filter((e) => app.liveFx.includes(e.id)) as e (e.id)}<button class="ghost" onclick={() => app.toggleEffect(e.id)} title="Stop {e.name}"><Icon name="stop" size={12} /></button>{/each}
      </div>
    {/if}

    <CellPicker />
    {#if hasLight}
    <section id="pg-int">
      <div class="lab"><span>Intensity</span><b><ValueEdit text={`${pct(first?.intensity)}%`} value={pct(first?.intensity)} label="Intensity" onset={(v) => app.set({ intensity: v / 100 })} />{#if out !== undefined && Math.abs(out - (first?.intensity ?? 0)) > 0.02}<span class="faint" title="What the light gives right now, after effects and the masters">&nbsp;· out {pct(out)}%</span>{/if}</b></div>
      <input class="big" type="range" min="0" max="1" step="0.01" value={first?.intensity ?? 0} oninput={setNum('intensity')} aria-label="Intensity" />
      <div class="quick">
        {#each [0, 0.25, 0.5, 0.75, 1] as v (v)}<button onclick={() => (v === 0 ? app.off() : app.set({ intensity: v }))}>{v === 0 ? 'Off' : v === 1 ? 'Full' : `${v * 100}`}</button>{/each}
      </div>
    </section>
    {/if}
    {#if has('fog', 'haze')}
      <section class="fogq">
        <div class="lab"><span>Fog / haze</span><span class="faint">{hasLight ? '' : 'the slider below sets the output'}</span></div>
        <div class="quick">{#each [0, 0.5, 1] as v (v)}<button onclick={() => app.set({ fog: v, haze: v })}>{v === 0 ? 'Off' : v === 1 ? 'Full' : 'Half'}</button>{/each}</div>
      </section>
    {/if}

    {#if !can.color && whitePresets.length && has('cct', 'warmWhite', 'coolWhite')}
      <section>
        <div class="lab"><span>White</span></div>
        <div class="swatches">
          {#each whitePresets as p (p.id)}
            <button class="sw" class:on={usesPreset(p.id)} title="{p.name} (preset)" aria-label={p.name} style="background:{css(p.values.color as Color)}" onclick={() => app.applyPreset(p.id)}></button>
          {/each}
        </div>
      </section>
    {/if}
    {#if can.color}
      <section id="pg-col">
        <div class="lab"><span>Colour</span>{#if first?.color}<span class="swatch" style="background:{css(first.color)}"></span>{/if}</div>
        {#if colorPresets.length}
          <div class="swatches">
            {#each colorPresets as p (p.id)}
              {@const c = p.values.color && !('preset' in p.values.color) ? p.values.color : { r: 1, g: 1, b: 1 }}
              <button class="sw" class:on={usesPreset(p.id)} title="{p.name} (preset)" aria-label={p.name} style="background:{css(c as Color)}" onclick={() => app.applyPreset(p.id)}></button>
            {/each}
          </div>
        {/if}
        <ColorWheel value={first?.color} onpick={(c) => { app.set({ color: c }); app.lightUpIfDark(); }} />
        {#if noColor.length}
          <p class="faint note">{noColor.length > 3 ? `${noColor.length} of these lights` : noColor.map((f) => f.name).join(', ')} can't make colours: a white sets their warmth, other colours leave them white.</p>
        {/if}
        {#if sel.length > 1}
          <div class="spread">
            <span class="faint">Across the selection:</span>
            <button onclick={() => app.spreadColors('rainbow')} title="Each light a different colour, rainbow order">Rainbow</button>
            <span class="grad" title="From one colour to another, in the fixture order">
              <input type="color" bind:value={gradA} aria-label="Gradient from" /><input type="color" bind:value={gradB} aria-label="Gradient to" />
              <button onclick={() => app.spreadColors(fromHex(gradA), fromHex(gradB))}>Gradient</button>
            </span>
          </div>
        {/if}
      </section>
    {/if}

    {#each picks as p (p.k)}
      <section class="pick" aria-label={p.label}>
        <div class="lab"><span>{p.label}</span><span class="faint">{p.cur >= 0 ? p.slots[p.cur] : ''}</span></div>
        {#if p.slots.length <= 12}
          {@const pats = p.k === 'gobo' || p.k === 'gobo2' ? wheelPatterns(p.slots) : null}
          <div class="quick wrap">
            {#each p.slots as s, i (i)}<button class:on={i === p.cur && !p.wheel?.scroll} onclick={() => app.setSlot(p.k, s, i)} title={s}>{#if p.colors[i]}<span class="dot" style="background:{p.colors[i]}"></span>{/if}{#if pats}<GoboIcon pattern={pats[i]} />{/if}{s}</button>{/each}
          </div>
          {#if p.wheel}
            {@const w = p.wheel}
            {@const shake = w.shakes.find((r) => new RegExp(`(^|\\D)${p.cur + 1}(\\D|$)`).test(r.label ?? ''))}
            {@const sk = `${p.k}Shake`}
            {@const sc = `${p.k}Scroll`}
            <div class="quick wrap wheelfx" role="group" aria-label="{p.label}: shake and wheel">
              {#if shake}<button class:on={w.shaking} aria-pressed={w.shaking} onclick={() => app.set({ [sk]: w.shaking ? 0 : 0.5 } as Values)} title="{shake.label}: the gobo shakes back and forth (as the light does it)">Shake</button>{/if}
              {#if w.cw}<button class:on={w.scroll > 0} aria-pressed={w.scroll > 0} onclick={() => app.set({ [sc]: w.scroll > 0 ? 0 : 0.5 } as Values)} title="The whole wheel runs round through its gobos, clockwise">Wheel ↻</button>{/if}
              {#if w.ccw}<button class:on={w.scroll < 0} aria-pressed={w.scroll < 0} onclick={() => app.set({ [sc]: w.scroll < 0 ? 0 : -0.5 } as Values)} title="The whole wheel runs round through its gobos, counter-clockwise">Wheel ↺</button>{/if}
            </div>
          {/if}
        {:else}
          <select aria-label={p.label} value={p.cur} onchange={(e) => { const i = +(e.target as HTMLSelectElement).value; app.setSlot(p.k, p.slots[i], i); }}>
            {#if p.cur < 0}<option value={-1}>…</option>{/if}
            {#each p.slots as s, i (i)}<option value={i}>{s}</option>{/each}
          </select>
        {/if}
      </section>
    {/each}

    {#each SLIDERS as [k, label, chs] (k)}
      {#if has(...chs)}
        {@const named = rangesOf(k)}
        <section class="sl">
          <div class="lab"><span>{label}</span><b><ValueEdit text={valueLabel(k, first?.[k] as number | undefined)} value={pct(first?.[k] as number | undefined)} {label} onset={(v) => app.set({ [k]: v / 100 } as Values)} /></b></div>
          <!-- (a channel with named ranges, as real heads have them: one tap on each; the slider fine-tunes within) -->
          {#if named}
            <div class="quick wrap ranges" role="group" aria-label="{label}: ranges">
              {#each named as r (r.from)}<button class:on={inByte(first?.[k] as number | undefined, r)} onclick={() => app.set({ [k]: Math.round((r.from + r.to) / 2) / 255 } as Values)} title="{r.label} ({r.from}–{r.to})">{r.label}</button>{/each}
            </div>
          {/if}
          <input type="range" min="0" max="1" step="0.01" value={first?.[k] ?? (k === 'cct' ? 0.5 : 0)} oninput={setNum(k)} aria-label={label} class:cctbar={k === 'cct'} />
        </section>
      {/if}
    {/each}

    {#if can.position}
      <section id="pg-pos">
        <div class="lab"><span>Position</span><span class="faint">pan <ValueEdit text={String(pct(first?.pan ?? 0.5))} value={pct(first?.pan ?? 0.5)} label="Pan" onset={(v) => app.set({ pan: v / 100 })} />
          · tilt <ValueEdit text={String(pct(first?.tilt ?? 0.5))} value={pct(first?.tilt ?? 0.5)} label="Tilt" onset={(v) => app.set({ tilt: v / 100 })} /></span></div>
        <div class="pad" bind:this={pad} role="slider" aria-label="Pan and tilt" aria-valuenow={pct(first?.pan ?? 0.5)} tabindex="0"
             onpointerdown={aim} onpointermove={aim} onkeydown={padKey}>
          {#each sel as f (f.id)}
            {@const l = app.look[f.id]}
            {#if app.kinds[f.id] === 'mover'}<div class="cross" class:main={f.id === sel[0].id} style="left:{(l?.pan ?? 0.5) * 100}%;top:{(l?.tilt ?? 0.5) * 100}%"></div>{/if}
          {/each}
        </div>
        <div class="quick wrap">
          {#each posPresets as p (p.id)}<button class:on={usesPreset(p.id)} onclick={() => app.applyPreset(p.id)} title="Position preset">{p.name}</button>{/each}
          <button onclick={() => app.set({ pan: 0.5, tilt: 0.5 })}>Centre</button>
        </div>
        {#if sel.filter((f) => app.kinds[f.id] === 'mover').length > 1}
          <label class="fan" title="Spread the heads' pan around their middle, in fixture order. Back to 0 to bring them together.">
            <span class="faint">Fan</span>
            <input type="range" min="-0.8" max="0.8" step="0.01" value={0} oninput={(e) => app.fan(+(e.target as HTMLInputElement).value)} aria-label="Fan" />
          </label>
        {/if}
      </section>
    {/if}

    <div id="pg-all"></div>
    <Channels />
  {/if}

  {#if changed}
    <div class="foot row">
      <span class="faint">{changed} light{changed > 1 ? 's' : ''} changed</span><span class="grow"></span>
      <button onclick={() => app.clearProgrammer()} title="Let go of your changes: the cues take over again">Clear</button>
      <button class="rec" onclick={record} title="Record your changes as a new cue"><Icon name="record" />Record</button>
    </div>
  {/if}
</div>

<style>
  .prog { display: flex; flex-direction: column; gap: .6rem; min-height: 100%; }
  .head { flex-wrap: nowrap; }
  .names { margin-top: -.3rem; }
  .fxnote { display: flex; gap: .4rem; align-items: flex-start; font-size: .8rem; color: #ffd27a; background: #ffaa1c12; border: 1px solid #ffaa1c33; border-radius: var(--radius-s); padding: .35rem .5rem; }
  .fxnote span { flex: 1; }
  .spread { display: flex; flex-wrap: wrap; gap: .3rem; align-items: center; margin-top: .3rem; }
  .spread button { padding: .15rem .5rem; font-size: .8rem; }
  .grad { display: inline-flex; gap: .2rem; align-items: center; }
  .grad input { width: 26px; height: 24px; padding: 0; border-radius: 5px; }
  .fan { display: grid; grid-template-columns: auto 1fr; gap: .5rem; align-items: center; }
  section { display: flex; flex-direction: column; gap: .3rem; scroll-margin-top: 3rem; }   /* (clear of the jump bar when jumped to) */
  .lab { display: flex; justify-content: space-between; align-items: center; font-size: .86rem; }
  .lab b { font-weight: 600; font-size: .82rem; }
  .swatch { width: 1.1rem; height: 1.1rem; border-radius: 50%; border: 1px solid #0006; }
  input[type=range] { width: 100%; }
  .big { height: 1.6rem; }
  .quick { display: flex; gap: .25rem; }
  .quick button { flex: 1; padding: .25rem .2rem; font-size: .8rem; }
  .quick.wrap { flex-wrap: wrap; } .quick.wrap button { flex: 1 0 28%; }
  .pick .quick.wrap button { flex: 0 1 auto; display: inline-flex; align-items: center; gap: .25rem; }
  .pick .quick.wrap button.on { border-color: var(--accent); color: var(--accent); }
  .pick .dot { width: .7rem; height: .7rem; border-radius: 50%; border: 1px solid #0006; }
  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 40px)); gap: .35rem; justify-content: start; }
  .sw { aspect-ratio: 1; padding: 0; border-radius: 50%; border: 2px solid #0006; }
  .sw.on { border-color: var(--text); box-shadow: 0 0 0 2px var(--accent); }
  .pad { position: relative; aspect-ratio: 1.4; border-radius: 8px; background:
         linear-gradient(var(--line) 1px, transparent 1px) 0 0 / 25% 25%, linear-gradient(90deg, var(--line) 1px, transparent 1px) 0 0 / 25% 25%, #0b0f15;
         touch-action: none; cursor: crosshair; }
  .cross { position: absolute; width: 12px; height: 12px; margin: -6px; border-radius: 50%; border: 2px solid #ffaa1c88; pointer-events: none; }
  .cross.main { width: 16px; height: 16px; margin: -8px; border-color: var(--orange); background: #ffaa1c44; }
  .foot { position: sticky; bottom: -.7rem; margin: 0 -.7rem -.7rem; padding: .5rem .7rem; background: var(--panel); border-top: 1px solid var(--line); border-radius: 0 0 var(--radius) var(--radius); }
  .rec { background: #f33abc1a; border-color: #f33abc77; color: #ff7fd6; font-weight: 650; }
  .rec :global(svg) { fill: currentColor; }
  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: .4rem; padding: 1.5rem .3rem; color: var(--muted); }
  .quick { display: flex; flex-wrap: wrap; gap: .25rem; justify-content: center; margin-top: .2rem; }
  .quick .sm { padding: .15rem .55rem; font-size: .8rem; border-radius: 999px; }
  .now { display: flex; flex-direction: column; gap: .3rem; margin-top: .6rem; padding-top: .6rem; border-top: 1px solid var(--line); }
  .now h3 { margin: 0 0 .1rem; font-size: .76rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 650; }
  .pl { display: flex; align-items: center; gap: .4rem; font-size: .85rem; min-width: 0; }
  .pl .nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pl .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 6px var(--c); flex: none; }
  .pl input[type=range] { width: 64px; flex: none; }
  .pl .sm { padding: .1rem .5rem; font-size: .78rem; }
  .note { margin: .3rem 0 0; font-size: .78rem; }
  .jump { display: flex; gap: .25rem; flex-wrap: wrap; position: sticky; top: -.7rem; z-index: 2; background: var(--panel); padding: .3rem 0; }
  .jump .sm { padding: .2rem .7rem; min-height: 30px; font-size: .82rem; border-radius: 999px; }
  .jump .sm.cur { border-color: var(--accent); color: var(--accent); }
  /* colour temperature: the track shows warm to cool */
  .cctbar { appearance: none; height: 12px; border-radius: 6px; background: linear-gradient(90deg, #ffb46b, #fff3e0 50%, #d6e6ff); }
  .cctbar::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid #1a2029; box-shadow: 0 1px 4px #0008; }
  .cctbar::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid #1a2029; }
</style>
