<script lang="ts">
  // a typed time stays in what the field allows (0 to 10 minutes); the field shows what was kept
  const secs = (e: Event) => Math.min(600, Math.max(0, +(e.target as HTMLInputElement).value || 0));
  import { cueNum, cueNumber, freezeNumbers, takenBy } from '../model/cuenum';
  // Details of the selected cue(s). With several selected, timing changes apply to all of them.
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import type { Advance, Cue, CueAction } from '../model/types';
  import { lookColor } from '../engine/cuelook';
  import { resolveValues } from '../engine/resolve';

  const list = $derived(app.list);
  const sel = $derived(list?.cues.filter((c) => app.cueSel.includes(c.id)) ?? []);
  const one = $derived(sel.length === 1 ? sel[0] : undefined);
  const presets = $derived(new Map(app.show.presets.map((p) => [p.id, p])));

  function setAll<K extends keyof Cue>(k: K, v: Cue[K]) { for (const c of sel) c[k] = v; }
  // colour, position, beam: a time of their own, or (emptied) the fade again
  const FAMILIES = [['color', 'Colour'], ['position', 'Position'], ['beam', 'Beam']] as const;
  function setTime(k: 'color' | 'position' | 'beam', e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    for (const c of sel) {
      const t = { ...(c.times ?? {}) };
      if (raw === '') delete t[k]; else t[k] = Math.min(600, Math.max(0, +raw || 0));
      if (Object.keys(t).length) c.times = t; else delete c.times;
    }
  }
  function setAdvance(mode: Advance['mode']) {
    for (const c of sel) {
      const t = 'time' in c.advance ? c.advance.time : 'beats' in c.advance ? c.advance.beats : 0;
      c.advance = mode === 'manual' ? { mode } : mode === 'beats' ? { mode, beats: t || 4 } : { mode, time: t || 2 };
    }
  }
  function setAdvVal(v: number) {
    for (const c of sel) {
      if (c.advance.mode === 'beats') c.advance = { mode: 'beats', beats: Math.max(0.25, v) };
      else if (c.advance.mode !== 'manual') c.advance = { mode: c.advance.mode, time: Math.max(0, v) };
    }
  }
  const advVal = (a: Advance) => ('time' in a ? a.time : 'beats' in a ? a.beats : 0);
  function addAction(c: Cue) {
    const other = app.show.cueLists.find((l) => l.id !== list?.id);
    if (!c.actions) c.actions = [];
    c.actions.push(other ? { do: 'start', list: other.id } : { do: 'blackout', on: false });
  }
  function setDo(c: Cue, i: number, d: CueAction['do']) {
    const a = c.actions![i];
    const target = 'list' in a ? a.list : app.show.cueLists.find((l) => l.id !== list?.id)?.id ?? '';
    c.actions![i] = d === 'blackout' ? { do: 'blackout', on: true } : d === 'off' ? { do: 'off' } : d === 'master' ? { do: 'master', list: target, level: 1 }
      : d === 'goto' ? { do: 'goto', list: target, cue: app.show.cueLists.find((l) => l.id === target)?.cues[0]?.id ?? '' } : { do: d, list: target };
  }
  const fname = (id: string) => app.show.fixtures.find((f) => f.id === id)?.name ?? '(gone)';
</script>

<section class="insp" aria-label="Cue settings">
  {#if !sel.length}
    <p class="muted">Select a cue to see and change its timing, what happens next, and what it also does when it starts.</p>
  {:else}
    {#if one}
      <div class="row namerow">
        <!-- its number, like the script's (typing one keeps every cue's number from then on) -->
        <input class="cnum" inputmode="decimal" value={list ? cueNumber(list, list.cues.indexOf(one)) : ''} aria-label="Cue number" title="Cue number (20.5 goes between 20 and 21)"
               onchange={(e) => { const el = e.target as HTMLInputElement, v = Number(el.value.replace(',', '.'));
                 if (!list || !(v > 0) || !Number.isFinite(v)) { if (list) el.value = cueNumber(list, list.cues.indexOf(one)); return; }
                 app.checkpoint(); freezeNumbers(list); one.num = Math.round(v * 1000) / 1000; app.markDirty(0); }} />
        <input class="title" bind:value={one.name} aria-label="Cue name" />
      </div>
      {#if list}{@const dup = takenBy(list, one, cueNum(list, list.cues.indexOf(one)))}{#if dup}<p class="err small" role="status">"{dup.name}" has this number too.</p>{/if}{/if}
    {:else}
      <b>{sel.length} cues selected</b><span class="faint"> · changes apply to all</span>
    {/if}
    <div class="grid">
      <label>Fade <span><input type="number" min="0" max="600" step="0.5" value={sel[0].fade} oninput={(e) => setAll('fade', secs(e))} aria-label="Fade" /> s</span></label>
      <label>Then <select value={sel[0].advance.mode} onchange={(e) => setAdvance((e.target as HTMLSelectElement).value as Advance['mode'])} aria-label="Next cue">
        <option value="manual">wait for GO</option><option value="wait">next cue after N seconds</option>
        <option value="follow">next cue N seconds after the fade</option><option value="beats">next cue after N beats</option></select></label>
      {#if sel[0].advance.mode !== 'manual'}
        <label title={sel[0].advance.mode === 'wait' ? 'Counted from when the cue starts (the fade included)' : sel[0].advance.mode === 'follow' ? 'Counted from when its fade is done' : 'At the tempo (Tap, or follow the music)'}>{sel[0].advance.mode === 'beats' ? 'Beats' : 'Seconds'} <span><input type="number" min={sel[0].advance.mode === 'follow' ? 0 : sel[0].advance.mode === 'beats' ? 1 : 0.1} step="0.5" value={advVal(sel[0].advance)}
             onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; const m = sel[0].advance.mode; if (Number.isFinite(v)) setAdvVal(Math.max(m === 'follow' ? 0 : m === 'beats' ? 1 : 0.1, v)); }} aria-label="Advance time" /></span></label>
      {/if}
    </div>
    <details>
      <summary class="muted">More timing</summary>
      <div class="grid">
        <label>Delay <span><input type="number" min="0" max="600" step="0.5" value={sel[0].delay ?? 0} oninput={(e) => setAll('delay', secs(e) || undefined)} aria-label="Delay" /> s</span></label>
        <label>Fade out <span><input type="number" min="0" max="600" step="0.5" value={sel[0].fadeOut ?? sel[0].fade} oninput={(e) => setAll('fadeOut', secs(e))} aria-label="Fade out" /> s</span></label>
        {#each FAMILIES as [k, label] (k)}
          <label>{label} <span><input type="number" min="0" max="600" step="0.5" value={sel[0].times?.[k] ?? ''} placeholder={String(sel[0].fade)} oninput={(e) => setTime(k, e)} aria-label="{label} time" /> s</span></label>
        {/each}
      </div>
      <p class="faint">Delay waits before the fade starts. Fade out is used for lights getting darker, e.g. a quick blackout but a slow fade up. Colour, Position and Beam can take times of their own (empty: the fade): a colour that changes at once while the heads take 4 s to move.</p>
    </details>
    {#if one}
      <label class="note">Note <textarea rows="2" value={one.note ?? ''} oninput={(e) => (one.note = (e.target as HTMLTextAreaElement).value || undefined)} aria-label="Note"></textarea></label>
      <div class="sec">
        <div class="row"><span class="muted">When it starts, also:</span><button class="ghost" onclick={() => addAction(one)}><Icon name="plus" />action</button></div>
        {#each one.actions ?? [] as a, ai (ai)}
          <div class="act">
            <select value={a.do} onchange={(e) => setDo(one, ai, (e.target as HTMLSelectElement).value as CueAction['do'])} aria-label="Action">
              <option value="start">start</option><option value="go">GO on</option><option value="goto">play cue</option><option value="release">fade out</option>
              <option value="stop">stop</option><option value="master">set level of</option><option value="off">everything off</option><option value="blackout">blackout</option></select>
            {#if a.do === 'goto'}
              {@const tl = app.show.cueLists.find((l) => l.id === a.list)}
              <select value={a.cue} onchange={(e) => (a.cue = (e.target as HTMLSelectElement).value)} aria-label="Action cue">{#each tl?.cues ?? [] as c, ci (c.id)}<option value={c.id}>{tl ? cueNumber(tl, ci) : ci + 1}. {c.name}</option>{/each}</select>
              <span class="muted">of</span>
              <select value={a.list} aria-label="Action list" onchange={(e) => { a.list = (e.target as HTMLSelectElement).value; a.cue = app.show.cueLists.find((l) => l.id === a.list)?.cues[0]?.id ?? ''; }}>
                {#each app.show.cueLists.filter((l) => l.id !== list?.id) as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select>
            {:else if 'list' in a}<select bind:value={a.list} aria-label="Action list">{#each app.show.cueLists.filter((l) => l.id !== list?.id) as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select>{/if}
            {#if a.do === 'master'}<input type="number" min="0" max="100" value={Math.round(a.level * 100)} oninput={(e) => (a.level = Math.min(100, Math.max(0, +(e.target as HTMLInputElement).value || 0)) / 100)} style="width:3.8em" />%{/if}
            {#if a.do === 'blackout'}<select bind:value={a.on}><option value={true}>on</option><option value={false}>off</option></select>{/if}
            <button class="ghost" onclick={() => one.actions!.splice(ai, 1)} aria-label="Remove action"><Icon name="close" size={14} /></button>
          </div>
        {/each}
      </div>
      <div class="sec">
        <span class="muted">Lights in this cue ({Object.keys(one.values).length})</span>
        <div class="fixtures">
          {#each Object.entries(one.values) as [fid, v] (fid)}
            {@const lc = lookColor(resolveValues(v, fid, presets))}
            <span class="fxc" title="Remove {fname(fid)} from this cue">
              <span class="sw" style="background:{lc.css}"></span>{fname(fid)}
              <button class="ghost" onclick={() => delete one.values[fid]} aria-label="Remove {fname(fid)} from cue"><Icon name="close" size={12} /></button>
            </span>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .insp { width: 270px; flex: none; overflow: auto; border-left: 1px solid var(--line); padding-left: .6rem; display: flex; flex-direction: column; gap: .45rem; font-size: .88rem; }
  .title { font-weight: 650; flex: 1; min-width: 0; }
  .namerow { gap: .4rem; } .small { font-size: .8rem; margin: 0; } .cnum { width: 4.2em; text-align: center; font-weight: 650; font-variant-numeric: tabular-nums; }
  .grid { display: grid; grid-template-columns: minmax(5.5rem, 1fr) minmax(0, 2fr); gap: .4rem; }
  details .grid { grid-template-columns: 1fr 1fr; }
  /* a long "Then" choice must never squeeze the number next to it */
  label select { width: 100%; min-width: 0; text-overflow: ellipsis; }
  label span input { min-width: 3.4rem; flex: 1; }
  label { display: flex; flex-direction: column; gap: .15rem; color: var(--muted); font-size: .82rem; }
  label span { display: flex; align-items: center; gap: .25rem; color: var(--muted); }
  label input { width: 100%; }
  .note textarea { resize: vertical; }
  .sec { display: flex; flex-direction: column; gap: .3rem; }
  .act { display: flex; gap: .25rem; align-items: center; flex-wrap: wrap; }
  .fixtures { display: flex; flex-wrap: wrap; gap: .2rem; }
  .fxc { display: inline-flex; align-items: center; gap: .25rem; font-size: .78rem; border: 1px solid var(--line); border-radius: 999px; padding: 0 .1rem 0 .35rem; }
  .sw { width: .6rem; height: .6rem; border-radius: 50%; border: 1px solid #0006; }
  .fxc button { padding: .05rem; }
  @media (max-width: 1100px) { .insp { width: 210px; } }
  @media (max-width: 760px) { .insp { width: auto; border-left: 0; border-top: 1px solid var(--line); padding: .5rem 0 0; } }
</style>
