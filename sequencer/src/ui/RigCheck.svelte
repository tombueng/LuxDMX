<script lang="ts">
  // The rig check: every light on the rig that answers RDM, found on every connected box, held
  // against the patch. What matches, what's off (and the fix either way), what the show doesn't know
  // (patch it from the rig, with its own profile when the fixture library knows it), and how the
  // lights are doing while you watch: their sensors over time, status messages, lights that stop
  // answering. The logic is rdm/rig.svelte.ts and rdm/match.ts.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { rig } from '../rdm/rig.svelte';
  import { STATUS_LEVEL, type RdmDevice } from '../rdm/types';
  import type { DeviceCheck, Fix } from '../rdm/match';

  let { onclose }: { onclose: () => void } = $props();
  const check = $derived(rig.check);
  const byUid = $derived(new Map(check.devices.map((c) => [c.uid, c])));
  const fixture = (id?: string) => (id ? app.show.fixtures.find((f) => f.id === id) : undefined);
  const name = (d: RdmDevice) => d.label || d.model || d.uid;
  const end = (addr: number, n: number) => (n > 1 ? `${addr}–${addr + n - 1}` : `${addr}`);
  const modeName = (d: RdmDevice) => d.modeList?.find((m) => m.n === d.mode)?.name ?? `mode ${d.mode}`;
  const ready = $derived((app.bridgeRev, app.bridges.filter((b) => b.state === 'ready')));
  const unpatched = $derived(check.devices.filter((c) => c.problems.includes('unpatched')).map((c) => c.uid));
  const plan = $derived(rig.plan());
  // the universes there's something in: the lights' and the scanned lines'
  const unis = $derived([...new Set([...rig.devices.map((d) => d.uni), ...rig.sources.flatMap((s) => s.lines.map((l) => l.uni))])].sort((a, b) => a - b));
  let sel = $state<string | null>(null);
  let busy = $state<string | null>(null);

  // (the box may have a list from its own last scan: shown at once, no scan needed)
  $effect(() => { if (ready.length && !rig.sources.length) void rig.refresh(); });

  async function run(key: string, f: () => Promise<unknown>) { busy = key; try { await f(); } finally { busy = null; } }
  function fixLabel(f: Fix, d: RdmDevice): string {
    if (f.kind === 'patch') return 'Patch it';
    if (f.to === 'light') return f.kind === 'address' ? `Set the light to ${f.addr}` : `Light to ${d.modeList?.find((m) => m.n === f.mode)?.name ?? `mode ${f.mode}`}`;
    return f.kind === 'address' ? `Move the patch to ${f.universe}.${f.addr}` : `Patch as ${f.mode}`;
  }
  function fixTitle(f: Fix): string {
    return f.to === 'light' ? 'Changes the real light over RDM (the show stays as it is)' : 'Changes the show\'s patch (the light stays as it is; Undo takes it back)';
  }
  function pick(d: RdmDevice) {
    sel = d.uid;
    const f = byUid.get(d.uid)?.fixture;
    if (f) app.selected = [f];
  }
  const problemText: Record<string, string> = { address: 'another address', mode: 'another mode', clash: 'shares channels', unpatched: 'not in the show' };
  function health(c: DeviceCheck | undefined, d: RdmDevice) {
    if (rig.gone(d.uid)) return 'gone';
    if (!c) return 'ok';
    if (c.problems.includes('clash')) return 'bad';
    if (c.problems.length) return 'warn';
    return STATUS_LEVEL(d.status.type) === 'error' ? 'bad' : STATUS_LEVEL(d.status.type) === 'warning' ? 'warn' : 'ok';
  }
  // a sensor's readings over time, as a small line
  function spark(uid: string, sensor: string, _rev: number) {
    const h = rig.history.get(uid)?.get(sensor) ?? [];
    if (h.length < 2) return '';
    const vs = h.map((x) => x[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(1, hi - lo);
    return h.map((x, i) => `${((i / (h.length - 1)) * 60).toFixed(1)},${(14 - ((x[1] - lo) / span) * 12).toFixed(1)}`).join(' ');
  }
  const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

<Modal title="The rig (RDM)" wide {onclose}>
  <div class="rig">
    <div class="bar">
      <button class="primary" onclick={() => run('scan', () => rig.scan())} disabled={rig.scanning || !ready.length} aria-busy={rig.scanning}>
        <Icon name="search" />{rig.scanning ? `Scanning… ${rig.devices.length} found` : rig.devices.length ? 'Scan again' : 'Scan the rig'}</button>
      <label class="ck" title="Reads every box every few seconds: lights that stop answering, status messages and hot sensors show up below, and on the boxes button">
        <input type="checkbox" checked={rig.watching} onchange={(e) => rig.watch((e.target as HTMLInputElement).checked)} /> Watch the rig</label>
      <span class="sum" aria-live="polite">
        <b>{rig.devices.length}</b> light{rig.devices.length === 1 ? '' : 's'}
        {#if check.ok}<span class="chip ok"><Icon name="check" size={12} />{check.ok} match</span>{/if}
        {#if check.issues}<span class="chip warn"><Icon name="warn" size={12} />{check.issues} to look at</span>{/if}
        {#if rig.goneList.length}<span class="chip bad">{rig.goneList.length} not answering</span>{/if}
        {#if check.silent.length}<span class="chip faint" title="Patched in a universe that was scanned, and nothing answers at their address: off, not connected, or a light without RDM (many have none)">{check.silent.length} patched, silent</span>{/if}
      </span>
    </div>

    {#if !ready.length}
      <p class="hint">Connect a LuxDMX box (or LuxDMX Link for Art-Net nodes) at the top right, then scan: every light that speaks RDM answers with who it is, where it listens and how it's doing.</p>
    {/if}
    <div class="srcs">
      {#each rig.sources as s (s.key)}
        <span class="src {s.can}" title={s.why ?? ''}><span class="dot"></span>{s.name}{#if s.can === 'no'}: {s.why}{:else if s.scan.busy}: {s.scan.stage === 'search' ? 'searching' : 'reading the lights'} ({s.scan.found}){/if}</span>
      {/each}
      <span class="faint note" title="sACN (E1.31) carries no RDM: lights on an sACN node are reached through the node's own RDM (a LuxDMX box does it itself) or over Art-Net">RDM through LuxDMX boxes and Art-Net (LuxDMX Link); sACN has none of its own.</span>
    </div>

    {#if plan.length || unpatched.length}
      <div class="acts">
        {#if plan.length}
          <button class="primary" disabled={!!busy} onclick={() => run('match', () => rig.matchShow())} title="Sets every light that's off to what the show says, over RDM">
            <Icon name="wizard" />Make the rig match the show ({plan.length} change{plan.length === 1 ? '' : 's'})</button>
          <details class="planlist"><summary>What changes</summary>
            <ul>{#each plan as f, i (i)}{@const d = rig.device(f.uid)}{#if d}<li>{name(d)}: {fixLabel(f, d).toLowerCase()}</li>{/if}{/each}</ul></details>
        {/if}
        {#if unpatched.length}
          <button class="ghost" disabled={!!busy} onclick={() => run('patch', () => rig.patch(unpatched))} title="Adds them to the show where they are: their own profile when the fixture library knows them, else a plain one with their channels">
            <Icon name="plus" />Patch the {unpatched.length} new light{unpatched.length === 1 ? '' : 's'}</button>
        {/if}
      </div>
    {/if}

    {#each unis as u (u)}
      {@const lights = rig.devices.filter((d) => d.uni === u)}
      {@const fx = app.show.fixtures.filter((f) => f.universe === u)}
      <figure class="strip" aria-label="Universe {u}: the show above, the rig below">
        <figcaption>Universe {u}</figcaption>
        <svg viewBox="0 0 512 26" preserveAspectRatio="none" role="img" aria-label="Channels 1 to 512 of universe {u}">
          <rect x="0" y="0" width="512" height="11" class="lane" /><rect x="0" y="14" width="512" height="11" class="lane" />
          {#each fx as f (f.id)}
            {@const n = app.modeOf(f.id)?.channels.length ?? 1}
            {@const linked = check.devices.find((c) => c.fixture === f.id)}
            <rect x={f.address - 1} y="0.5" width={n} height="10" class="fx {linked ? (linked.problems.length ? 'warn' : 'ok') : check.silent.includes(f.id) ? 'silent' : ''}"><title>{f.name}: {end(f.address, n)} ({n} ch)</title></rect>
          {/each}
          {#each lights as d (d.uid)}
            <rect x={d.addr - 1} y="14.5" width={Math.max(1, d.footprint)} height="10" class="dv {health(byUid.get(d.uid), d)}" class:sel={sel === d.uid} onclick={() => pick(d)} role="presentation"><title>{name(d)}: {end(d.addr, d.footprint)} ({d.footprint} ch)</title></rect>
          {/each}
        </svg>
        <div class="legend faint"><span>show</span><span>rig</span></div>
      </figure>
    {/each}

    {#if rig.devices.length}
      <ul class="list" aria-label="The lights found">
        {#each rig.devices as d (d.uid)}
          {@const c = byUid.get(d.uid)}
          {@const f = fixture(c?.fixture)}
          {@const st = health(c, d)}
          <li class="row {st}" class:sel={sel === d.uid} data-uid={d.uid}>
            <button class="who ghost" onclick={() => pick(d)} title="Select its fixture (in the list, the plan and the 3D stage)">
              <span class="dot"></span>
              <span class="nm"><b>{name(d)}</b><small>{d.maker || 'Unknown maker'} · {d.model || `model ${d.modelId}`}</small><small class="mono">{d.uid}</small></span>
            </button>
            <span class="where"><b>{d.uni}.{end(d.addr, d.footprint)}</b><small>{modeName(d)} · {d.footprint} ch{d.modes > 1 ? ` · ${d.mode}/${d.modes}` : ''}</small></span>
            <span class="patch">
              {#if f}<b>{f.name}</b><small>{f.universe}.{end(f.address, app.modeOf(f.id)?.channels.length ?? 1)}{#if !f.uid} · by its address{/if}</small>
              {:else}<small class="faint">not in the show</small>{/if}
              {#if c?.problems.length}<small class="probs">{c.problems.map((p) => problemText[p]).join(', ')}</small>{/if}
            </span>
            <span class="health">
              {#each d.sensors.slice(0, 2) as s (s.name)}
                <span class="sensor" title="{s.name}: {s.value} {s.unit} (lowest {s.lo}, highest {s.hi})">
                  <small>{s.name}</small><b>{s.value}{s.unit === 'C' ? '°C' : ` ${s.unit}`}</b>
                  <svg viewBox="0 0 60 16" class="spark" aria-hidden="true"><polyline points={spark(d.uid, s.name, rig.historyRev)} /></svg>
                </span>
              {/each}
              {#if d.status.type}<small class="status {STATUS_LEVEL(d.status.type)}">{STATUS_LEVEL(d.status.type)} {d.status.id}</small>{/if}
              {#if rig.gone(d.uid)}<small class="status error">not answering</small>{/if}
              {#if d.hours !== undefined}<small class="faint">{d.hours} h</small>{/if}
            </span>
            <span class="do">
              <button class="ghost sm" class:on={d.identify} aria-pressed={d.identify} disabled={busy === `id${d.uid}`}
                onclick={() => { pick(d); void run(`id${d.uid}`, () => rig.identify(d.uid, !d.identify)); }} title="The real light flashes so you can find it on the rig">
                <Icon name="sun" size={14} />Identify</button>
              {#each rig.fixes(d.uid) as fixIt, i (i)}
                <button class="sm {fixIt.to === 'light' ? 'primary' : 'ghost'}" disabled={!!busy} title={fixTitle(fixIt)} onclick={() => run(`fix${d.uid}${i}`, () => rig.apply(fixIt))}>{fixLabel(fixIt, d)}</button>
              {/each}
              {#if f && !c?.problems.length && !f.uid}<button class="ghost sm" title="The fixture remembers this light: the check follows it wherever its address goes" onclick={() => rig.link(d.uid, f.id)}>Remember it</button>{/if}
              {#if f && d.label !== f.name.slice(0, 32)}<button class="ghost sm" title="Writes the fixture's name into the light (its RDM label)" disabled={!!busy} onclick={() => run(`lbl${d.uid}`, () => rig.setLabel(d.uid, f.name.slice(0, 32)))}>Name it "{f.name}"</button>{/if}
            </span>
          </li>
        {/each}
      </ul>
    {:else if ready.length && !rig.scanning}
      <p class="hint">Nothing found yet. <b>Scan the rig</b>: each box searches its DMX lines for lights that speak RDM (a few seconds; the lights keep their look meanwhile).</p>
    {/if}

    {#if rig.events.length}
      <details class="log">
        <summary>What happened ({rig.events.length})</summary>
        <ol>{#each rig.events.slice(0, 80) as e (e.at + e.text)}<li class={e.kind}><time>{clock(e.at)}</time> {e.text}</li>{/each}</ol>
      </details>
    {/if}
  </div>
</Modal>

<style>
  .rig { display: flex; flex-direction: column; gap: .7rem; width: min(1040px, 100%); }
  .bar, .acts { display: flex; flex-wrap: wrap; gap: .5rem .8rem; align-items: center; }
  .ck { display: inline-flex; gap: .35rem; align-items: center; font-size: .9rem; }
  .sum { display: inline-flex; gap: .4rem; align-items: center; flex-wrap: wrap; margin-left: auto; font-size: .9rem; color: var(--muted); }
  .sum b { color: var(--text); }
  .chip { display: inline-flex; align-items: center; gap: .25rem; padding: .1rem .5rem; border-radius: 999px; border: 1px solid var(--line2); font-size: .8rem; }
  .chip.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 50%, transparent); }
  .chip.warn { color: var(--orange); border-color: color-mix(in srgb, var(--orange) 50%, transparent); }
  .chip.bad { color: var(--pink); border-color: color-mix(in srgb, var(--pink) 50%, transparent); }
  .srcs { display: flex; flex-wrap: wrap; gap: .3rem .8rem; font-size: .82rem; align-items: center; }
  .src { display: inline-flex; gap: .35rem; align-items: center; }
  .src .dot { width: .5rem; height: .5rem; border-radius: 50%; background: var(--muted); }
  .src.yes .dot { background: var(--green); } .src.no .dot { background: var(--pink); } .src.no { color: var(--muted); }
  .note { margin-left: auto; }
  .planlist { font-size: .82rem; color: var(--muted); } .planlist ul { margin: .3rem 0 0; padding-left: 1.1rem; }
  .hint { margin: 0; color: var(--muted); font-size: .9rem; }
  .strip { margin: 0; display: grid; grid-template-columns: 6.5rem 1fr auto; gap: .5rem; align-items: center; }
  .strip figcaption { font-size: .82rem; color: var(--muted); }
  .strip svg { width: 100%; height: 34px; display: block; }
  .legend { display: flex; flex-direction: column; font-size: .7rem; line-height: 17px; }
  .lane { fill: var(--panel2); }
  .fx { fill: color-mix(in srgb, var(--muted) 55%, transparent); }
  .fx.ok, .dv.ok { fill: var(--green); } .fx.warn, .dv.warn { fill: var(--orange); } .dv.bad { fill: var(--pink); } .dv.gone { fill: var(--muted); }
  .fx.silent { fill: color-mix(in srgb, var(--muted) 30%, transparent); }
  .dv { cursor: pointer; stroke: var(--bg); stroke-width: .6; } .dv.sel { stroke: var(--text); stroke-width: 1.2; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
  .row { display: grid; grid-template-columns: minmax(12rem, 1.3fr) minmax(7rem, .8fr) minmax(8rem, 1fr) minmax(9rem, 1fr) minmax(12rem, 1.6fr); gap: .6rem; align-items: center;
    padding: .35rem .5rem; border: 1px solid var(--line); border-radius: var(--radius-s); background: var(--panel); }
  .row.sel { border-color: var(--accent); }
  .row .dot { width: .6rem; height: .6rem; border-radius: 50%; background: var(--green); flex: none; }
  .row.warn .dot { background: var(--orange); } .row.bad .dot { background: var(--pink); } .row.gone .dot { background: var(--muted); }
  .row.gone { opacity: .6; }
  .who { display: flex; gap: .5rem; align-items: center; text-align: left; padding: .1rem; min-width: 0; }
  .nm, .where, .patch { display: flex; flex-direction: column; min-width: 0; }
  .nm b, .patch b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { font-size: .75rem; color: var(--muted); }
  .mono { font-family: var(--mono, monospace); }
  .probs { color: var(--orange); }
  .health { display: flex; flex-wrap: wrap; gap: .3rem .6rem; align-items: center; }
  .sensor { display: inline-grid; grid-template-columns: auto auto; column-gap: .3rem; align-items: center; }
  .sensor small { grid-column: 1 / -1; }
  .spark { width: 60px; height: 16px; } .spark polyline { fill: none; stroke: var(--accent); stroke-width: 1.4; }
  .status { padding: 0 .35rem; border-radius: 4px; } .status.warning { color: var(--orange); } .status.error { color: var(--pink); } .status.advice { color: var(--accent); }
  .do { display: flex; flex-wrap: wrap; gap: .3rem; justify-content: flex-end; }
  .sm { padding: .1rem .5rem; font-size: .8rem; display: inline-flex; gap: .25rem; align-items: center; }
  .sm.on { border-color: var(--orange); color: var(--orange); }
  .log { font-size: .82rem; } .log ol { list-style: none; margin: .4rem 0 0; padding: 0; max-height: 14rem; overflow: auto; display: flex; flex-direction: column; gap: .15rem; }
  .log time { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: .4rem; }
  .log .gone, .log .error { color: var(--pink); } .log .back, .log .found { color: var(--green); } .log .status, .log .hot { color: var(--orange); }
  @media (max-width: 760px) {
    .row { grid-template-columns: 1fr 1fr; } .who, .do { grid-column: 1 / -1; } .do { justify-content: flex-start; }
    .strip { grid-template-columns: 1fr; } .legend { display: none; } .sum { margin-left: 0; } .note { margin-left: 0; }
  }
</style>
