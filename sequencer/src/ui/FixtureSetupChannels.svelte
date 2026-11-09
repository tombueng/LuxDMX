<script lang="ts">
  // A light's mode, channel by channel (the patch dialog's Channels tab), to hold next to the DMX
  // table in its manual and to try on the real light: every channel has a slider that sends that
  // value (in the programmer, so Blind and the machines' arming apply as everywhere), and what a
  // channel does can be changed right here, for all lights of the type or only for this one (a copy
  // of the type). A ring or a matrix shows one pixel's channels, standing for all of them. Its other
  // modes say plainly what picking one does: the channel count, and which lights after it move.
  import { app, newId } from '../app.svelte';
  import { ATTR_GROUPS, ATTR_LABEL } from './attrs';
  import { channelRows, modeChange, type PatchedLight } from '../model/fixtureSetup';
  import { channelAt, isWide } from '../model/pixelLayout';
  import type { Channel, ChannelAttr, FixtureType } from '../model/types';

  let { id }: { id: string } = $props();
  const f = $derived(app.show.fixtures.find((x) => x.id === id));
  const t = $derived(f ? app.types.get(f.typeId) : undefined);
  const m = $derived(app.modeOf(id));
  const patched = $derived(app.show.fixtures.map((x): PatchedLight => ({ id: x.id, name: x.name, universe: x.universe, address: x.address, channels: app.modeOf(x.id)?.channels.length ?? 1 })));
  const others = $derived(t && m ? t.modes.filter((x) => x.name !== m.name).map((x) => ({ mode: x, c: modeChange(patched, id, x.channels.length) })) : []);
  const same = $derived(f ? app.show.fixtures.filter((x) => x.typeId === f.typeId).map((x) => x.id) : []);
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;

  // ---- editing: a copy of the mode's channels until it's saved
  let draft = $state<Channel[] | null>(null);
  const chans = $derived(draft ?? m?.channels ?? []);
  const dirty = $derived(!!draft && !!m && JSON.stringify($state.snapshot(draft)) !== JSON.stringify(m.channels));
  function edit() { if (m) draft = JSON.parse(JSON.stringify(m.channels)); }
  function cancel() { draft = null; openRanges = null; }

  // ---- a ring or a matrix: each pixel has the same channels, so one pixel stands for all of them
  const cellOf = $derived(chans.map((c) => c.cell));
  const cells = $derived(cellOf.reduce<number>((a, c) => Math.max(a, (c ?? -1) + 1), 0));
  const pixels = $derived(cells > 1 && !!m?.layout);
  // the channel indexes of each pixel, and the k-th channel of every pixel
  const perCell = $derived.by(() => { const out: number[][] = Array.from({ length: cells }, () => []); cellOf.forEach((c, i) => { if (c !== undefined) out[c]?.push(i); }); return out; });
  const kth = (k: number) => perCell.map((list) => list[k]).filter((i) => i !== undefined);
  // the rows shown: [the channel, the channels it stands for]
  const rows = $derived.by((): { i: number; all: number[] }[] => {
    if (!pixels) return chans.map((_, i) => ({ i, all: [i] }));
    const out: { i: number; all: number[] }[] = [];
    chans.forEach((c, i) => { if (c.cell === undefined) out.push({ i, all: [i] }); });
    (perCell[0] ?? []).forEach((i, k) => out.push({ i, all: kth(k) }));
    return out.sort((a, b) => a.i - b.i);
  });
  const fineOf = $derived(m && f ? channelRows({ ...m, channels: chans }, f.address).map((r) => r.fineOf) : []);
  // (on a pixel, the name without its number: "Red 1" stands for every pixel's red)
  const plain = (c: Channel) => (pixels && c.cell !== undefined ? c.name.replace(/\s*\d+$/, '') : c.name);

  function setAttr(all: number[], attr: ChannelAttr) {
    if (!draft) return;
    const label = (ATTR_LABEL[attr] ?? attr).split(' (')[0];
    for (const i of all) {
      const c = draft[i];
      if (!c) continue;
      c.attr = attr;
      if (pixels && c.cell !== undefined) c.name = `${label} ${c.cell + 1}`;
    }
  }
  function setName(all: number[], name: string) {
    if (!draft) return;
    for (const i of all) { const c = draft[i]; if (c) c.name = pixels && c.cell !== undefined ? `${name} ${c.cell + 1}` : name; }
  }
  function setDefault(all: number[], v: number) {
    if (!draft) return;
    for (const i of all) { const c = draft[i]; if (!c) continue; if (Number.isFinite(v) && v > 0) c.default = Math.min(255, Math.round(v)); else delete c.default; }
  }
  function setFine(i: number, on: boolean) { if (draft?.[i]) { if (on) draft[i].fine = true; else delete draft[i].fine; } }
  let openRanges = $state<number | null>(null);
  function addRange(c: Channel) {
    const last = c.ranges?.[c.ranges.length - 1];
    if (!c.ranges) c.ranges = [];
    c.ranges.push({ from: last ? Math.min(255, last.to + 1) : 0, to: 255, label: 'Range', kind: 'other' });
  }

  // saved for every light of this type (a type of your own changes in place, any other becomes a
  // copy the lights use), or for this light only (always a copy)
  function save(only: boolean) {
    if (!t || !m || !f || !draft) return;
    const channels = JSON.parse(JSON.stringify($state.snapshot(draft))) as Channel[];
    for (const c of channels) {
      if (c.ranges) c.ranges = c.ranges.filter((r) => r.to >= r.from).map((r) => ({ ...r, from: Math.max(0, Math.min(255, r.from)), to: Math.max(0, Math.min(255, r.to)) }));
      if (c.ranges && !c.ranges.length) delete c.ranges;
    }
    const copy: FixtureType = JSON.parse(JSON.stringify(t));
    copy.modes = copy.modes.map((x) => (x.name === m.name ? { ...x, channels } : x));
    const inPlace = !only && t.source === 'user';
    if (!inPlace) {
      copy.id = newId('user:'); copy.source = 'user';
      copy.model = `${t.model} (${only ? f.name : 'changed'})`;
    }
    app.saveType(copy);
    const to = only ? [id] : same;
    if (!inPlace) for (const x of to) { const g = app.show.fixtures.find((y) => y.id === x); if (g) g.typeId = copy.id; }
    app.markDirty(0);
    app.toastUndo(only ? `${f.name} has its own channels now` : inPlace ? `Saved for all ${plural(same.length, 'light')} of this type` : `${plural(same.length, 'light')} use the changed type now`);
    draft = null; openRanges = null;
  }

  // ---- trying it: a value per channel on the real light, held until let go
  const live = (i: number) => { if (!f) return 0; const w = channelAt(f, m, i); return app.frames.get(w.universe)?.[w.at] ?? 0; };
  const held = (i: number) => app.programmer[id]?.raw?.[String(i)];
  const heldAny = $derived(Object.keys(app.programmer[id]?.raw ?? {}).length > 0);
  const send = (all: number[], v: number | undefined) => app.setRawOf(id, all.map((i) => [i, v]));
  function allTo(what: 'default' | 'zero' | 'full') {
    if (!m) return;
    app.setRawOf(id, m.channels.map((c, i) => [i, what === 'default' ? c.default ?? 0 : what === 'zero' ? 0 : 255]));
  }
  function letGoAll() { if (!m) return; app.setRawOf(id, m.channels.map((_, i) => [i, undefined])); }
  const machine = $derived(!!f && (app.caps(id).fog || app.caps(id).sfx));

  function use(name: string, moves: { id: string; to: number }[]) {
    if (!f) return;
    app.checkpoint();
    f.mode = name;
    for (const mv of moves) { const g = app.show.fixtures.find((x) => x.id === mv.id); if (g) g.address = mv.to; }
    app.markDirty(0);
    app.toastUndo(`${f.name} now in ${name}${moves.length ? `; ${moves.length} light${moves.length === 1 ? '' : 's'} after it moved up` : ''}`);
  }
  const num = (e: Event) => (e.target as HTMLInputElement).valueAsNumber;
  const where = (i: number) => { if (!f) return ''; const w = channelAt(f, m, i); return isWide(m) ? `${w.universe}.${w.at + 1}` : `${w.at + 1}`; };
</script>

{#if f && m}
  <div class="chan">
    <p class="sum"><b>{m.name}</b>: {plural(m.channels.length, 'channel')}, {f.universe}.{f.address}{m.channels.length > 1 && !isWide(m) ? ` to ${f.address + m.channels.length - 1}` : ''}{isWide(m) ? `, over ${new Set(m.channels.map((_, i) => channelAt(f, m, i).universe)).size} universes` : ''}.
      <span class="faint">Check it against the DMX table in the light's manual (the light must be set to the same mode). Every slider sends to the real light.</span></p>

    <div class="bar">
      <span class="faint">Try:</span>
      <button onclick={() => allTo('default')} title="Every channel to its default">All to default</button>
      <button onclick={() => allTo('zero')} title="Every channel to 0">All to 0</button>
      <button onclick={() => allTo('full')} title="Every channel to 255 (machines only fire while armed)">All full</button>
      <button onclick={letGoAll} disabled={!heldAny} title="Give every channel back to the show">Let go of all</button>
      <span class="grow"></span>
      {#if !draft}<button onclick={edit} title="Change what each channel does, its name, its default and its named ranges">Change what the channels do…</button>{/if}
    </div>
    {#if heldAny && app.output === 'blind'}
      <p class="note" role="status">Blind: nothing new goes out, the light keeps its look.
        <button class="ghost link" onclick={() => app.askOnStage()}>Go on stage</button></p>
    {/if}
    {#if machine}<p class="faint small">A machine's fire channels only go out while the machines are armed.</p>{/if}
    {#if pixels}<p class="faint small">{plural(cells, 'pixel')} with the same channels: each row stands for that channel on every pixel, and its slider sets all of them.</p>{/if}

    <div class="tw">
      <table aria-label="The channels of {m.name}">
        <thead><tr><th scope="col">Ch</th><th scope="col">DMX</th><th scope="col">Name</th><th scope="col">Does</th>{#if draft}<th scope="col" title="Low byte of a 16-bit pair">Fine</th>{/if}<th scope="col">Default</th><th scope="col">Slots / ranges</th><th scope="col">Try</th></tr></thead>
        <tbody>
          {#each rows as r (r.i)}
            {@const c = chans[r.i]}
            {@const h = held(r.i)}
            <tr class:fine={!!fineOf[r.i]} class:held={h !== undefined} data-ch={r.i + 1}>
              <td class="n">{r.i + 1}{#if r.all.length > 1}<small class="faint"> ×{r.all.length}</small>{/if}</td>
              <td class="n">{where(r.i)}</td>
              {#if draft}
                <td><input value={plain(c)} aria-label="Channel {r.i + 1} name" onchange={(e) => setName(r.all, (e.target as HTMLInputElement).value)} /></td>
                <td><select value={c.attr} aria-label="Channel {r.i + 1} does" onchange={(e) => setAttr(r.all, (e.target as HTMLSelectElement).value as ChannelAttr)}>
                  {#each ATTR_GROUPS as g (g.label)}<optgroup label={g.label}>{#each g.attrs as [a, l] (a)}<option value={a}>{l}</option>{/each}</optgroup>{/each}
                </select></td>
                <td><input type="checkbox" checked={!!c.fine} aria-label="Channel {r.i + 1} is the fine one" onchange={(e) => setFine(r.i, (e.target as HTMLInputElement).checked)} disabled={r.all.length > 1} /></td>
                <td><input type="number" min="0" max="255" value={c.default ?? 0} aria-label="Channel {r.i + 1} default" style="width:4.2em" onchange={(e) => setDefault(r.all, num(e))} /></td>
                <td><button class="ghost rg" onclick={() => (openRanges = openRanges === r.i ? null : r.i)} aria-expanded={openRanges === r.i} disabled={r.all.length > 1}>{c.ranges?.length ? `${c.ranges.length} named` : 'add'}</button></td>
              {:else}
                <td>{plain(c)}</td>
                <td>{#if fineOf[r.i]}fine, with channel {fineOf[r.i]} (16 bit){:else}{ATTR_LABEL[c.attr] ?? c.attr}{/if}{#if c.span}<small class="faint"> (uses {c.span[0]} to {c.span[1]})</small>{/if}</td>
                <td class="n">{c.default ?? 0}</td>
                <td class="rg">{#each c.ranges ?? [] as g, gi (gi)}<button class="slot ghost" title="Send {g.from} to {g.to} (the middle)" onclick={() => send(r.all, Math.round((g.from + g.to) / 2))}>{#if g.color}<i style="background:{g.color}"></i>{/if}{g.label || '…'} <small class="faint">{g.from}–{g.to}</small></button>{/each}</td>
              {/if}
              <td class="try">
                <input type="range" min="0" max="255" value={h ?? live(r.i)} aria-label="{plain(c)} value" oninput={(e) => send(r.all, num(e))} />
                <input class="v" type="number" min="0" max="255" value={h ?? live(r.i)} aria-label="{plain(c)} DMX value" onchange={(e) => { const v = num(e); if (Number.isFinite(v)) send(r.all, v); }} />
                <button class="x ghost" title="Give this channel back to the show" aria-label="Let go of {plain(c)}" disabled={h === undefined} onclick={() => send(r.all, undefined)}>×</button>
              </td>
            </tr>
            {#if draft && openRanges === r.i}
              <tr class="ranges"><td></td><td colspan="7">
                {#each c.ranges ?? [] as g, gi (gi)}
                  <div class="range">
                    <input type="number" min="0" max="255" bind:value={g.from} aria-label="From" /> – <input type="number" min="0" max="255" bind:value={g.to} aria-label="To" />
                    <input class="lbl" bind:value={g.label} aria-label="Range name" />
                    <select bind:value={g.kind} aria-label="Range kind">
                      <option value="other">other</option><option value="open">shutter open</option><option value="closed">shutter closed</option>
                      <option value="strobe">strobe</option><option value="slot">wheel slot</option>
                    </select>
                    {#if g.kind === 'slot'}<input type="color" value={g.color ?? '#ffffff'} aria-label="Slot colour" oninput={(e) => (g.color = (e.target as HTMLInputElement).value)} />{/if}
                    <button class="x ghost" onclick={() => c.ranges!.splice(gi, 1)} aria-label="Remove range">×</button>
                  </div>
                {/each}
                <button onclick={() => addRange(c)}>+ Range</button>
              </td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    {#if draft}
      <div class="bar save" role="group" aria-label="Save the channels">
        {#if dirty}
          <button class="primary" onclick={() => save(false)}>{same.length > 1 ? `Save for all ${same.length} lights of this type` : t?.source === 'user' ? 'Save it to the type' : 'Save'}</button>
          {#if same.length > 1}<button onclick={() => save(true)}>Only for {f.name}</button>{/if}
        {:else}<span class="faint">Change a name, what a channel does, a default or a range, then save.</span>{/if}
        <button class="ghost" onclick={cancel}>{dirty ? 'Throw the changes away' : 'Done'}</button>
      </div>
      <p class="faint small">{t?.source === 'user' ? 'This type is your own: saving for all changes it for every light that uses it.' : 'A type from the library stays as it is: the lights get a copy with your changes.'} Adding or removing channels: Change the channel layout in the fixture list's menu.</p>
    {/if}

    {#if others.length}
      <h3>Its other modes</h3>
      <ul class="modes">
        {#each others as o (o.mode.name)}
          {@const c = o.c}
          <li>
            <span class="mn"><b>{o.mode.name}</b> <span class="faint">{plural(o.mode.channels.length, 'channel')}</span></span>
            <span class="what">
              {#if c.delta === 0}The same number of channels: the addresses stay.
              {:else if c.delta < 0}{plural(-c.delta, 'channel')} fewer: it uses {f.address} to {c.end}{#if c.freed}, {c.freed[0]} to {c.freed[1]} come free{/if}.
              {:else}{plural(c.delta, 'channel')} more: it uses {f.address} to {c.end}.
                {#if c.past}<span class="err">{plural(c.past, 'channel')} past 512, the end of the universe.</span>{/if}
                {#if c.moves.length}It would run into {c.moves[0].name}: {c.moves.map((mv) => `${mv.name} ${mv.from} → ${mv.to}`).join(', ')} (set them on the lights too).{/if}
                {#if c.stuck}<span class="err">{c.stuck} would then run past 512.</span>{/if}
              {/if}
            </span>
            <span class="acts">
              <button onclick={() => use(o.mode.name, [])}>Use it</button>
              {#if c.moves.length && !c.stuck}<button class="primary" onclick={() => use(o.mode.name, c.moves)}>Use it, move the {plural(c.moves.length, 'light')} after it</button>{/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .chan { display: flex; flex-direction: column; gap: .6rem; }
  .sum { margin: 0; }
  .bar { display: flex; gap: .3rem; align-items: center; flex-wrap: wrap; }
  .bar button { padding: .2rem .6rem; font-size: .85rem; }
  .bar .grow { flex: 1; }
  .tw { max-height: 52vh; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-s); }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th { position: sticky; top: 0; z-index: 1; background: var(--panel2); text-align: left; color: var(--muted); font-weight: 600; padding: .3rem .5rem; }
  td { padding: .25rem .5rem; border-top: 1px solid var(--line); vertical-align: middle; }
  td.n { font-variant-numeric: tabular-nums; text-align: right; width: 3em; white-space: nowrap; }
  td input:not([type=checkbox]):not([type=range]), td select { min-width: 0; width: 100%; }
  tr.fine td { color: var(--muted); }
  tr.held { background: #ffaa1c14; }
  .rg { display: flex; flex-wrap: wrap; gap: .2rem .4rem; }
  .slot { white-space: nowrap; padding: .05rem .3rem; font-size: .8rem; min-height: 0; }
  .slot i { display: inline-block; width: .75em; height: .75em; border-radius: 50%; margin-right: .25em; vertical-align: -.05em; border: 1px solid #fff4; }
  .try { display: flex; align-items: center; gap: .3rem; min-width: 13rem; }
  .try input[type=range] { flex: 1; min-width: 6rem; accent-color: var(--orange); padding: 0; }
  .try .v { width: 3.6em; }
  .x { border: 0; background: none; color: var(--muted); padding: 0 .3rem; min-width: 0; }
  .range { display: flex; gap: .3rem; align-items: center; margin: .15rem 0; }
  .range input[type=number] { width: 4em; } .range .lbl { flex: 1; }
  .save { border-top: 1px solid var(--line); padding-top: .5rem; }
  .small { margin: 0; font-size: .8rem; }
  .note { margin: 0; font-size: .85rem; color: var(--orange); }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 0; min-width: 0; }
  h3 { margin: .3rem 0 0; font-size: .82rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .modes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .4rem; }
  .modes li { display: grid; grid-template-columns: minmax(8em, auto) 1fr auto; gap: .6rem; align-items: center; border: 1px solid var(--line); border-radius: var(--radius-s); padding: .4rem .6rem; }
  @media (max-width: 640px) { .modes li { grid-template-columns: 1fr; } }
  .what { font-size: .85rem; }
  .acts { display: flex; gap: .3rem; flex-wrap: wrap; justify-content: flex-end; }
  .err { color: var(--orange); }
</style>
