<script lang="ts">
  // In a light's patch: what the real light says over RDM (rdm/rig.svelte.ts), next to what the
  // patch says. Its address, mode, label and how it's doing; the fixes either way (the light set
  // to the patch over RDM, or the patch moved to the light), its mode set from its own list,
  // Identify, and "Remember it" for one matched by its address. Shown when the fixture knows its
  // light, or the rig check found one at its address.
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { rig } from '../rdm/rig.svelte';
  import { STATUS_LEVEL } from '../rdm/types';
  import type { Fix } from '../rdm/match';

  let { id }: { id: string } = $props();
  const f = $derived(app.show.fixtures.find((x) => x.id === id));
  const match = $derived(rig.check.devices.find((c) => c.fixture === id));
  const d = $derived(match ? rig.device(match.uid) : undefined);
  const ready = $derived((app.bridgeRev, app.bridges.some((b) => b.state === 'ready')));
  const n = $derived(app.modeOf(id)?.channels.length ?? 1);
  const span = (a: number, c: number) => (c > 1 ? `${a} to ${a + c - 1}` : `${a}`);
  const modeName = $derived(d ? d.modeList?.find((m) => m.n === d.mode)?.name ?? `mode ${d.mode}` : '');
  const fixes = $derived(d ? rig.fixes(d.uid) : []);
  const health = $derived.by(() => {
    if (!d) return { level: 'ok', text: '' };
    if (rig.gone(d.uid)) return { level: 'error', text: 'not answering' };
    const l = STATUS_LEVEL(d.status.type);
    return { level: l, text: l === 'ok' ? 'no messages' : `${l === 'advice' ? 'a note' : `a${l === 'error' ? 'n' : ''} ${l}`} (message ${d.status.id})` };
  });
  let busy = $state(false);
  async function run(what: () => Promise<unknown>, fail: string) {
    busy = true;
    try { if ((await what()) === false) ui.toast(fail, 5000); } finally { busy = false; }
  }
  function label(x: Fix): string {
    if (x.kind === 'patch') return 'Patch it';
    if (x.to === 'light') return x.kind === 'address' ? `Set the light to ${x.addr}` : `Light to ${d?.modeList?.find((m) => m.n === x.mode)?.name ?? `mode ${x.mode}`}`;
    return x.kind === 'address' ? `Move the patch to ${x.universe}.${x.addr}` : `Patch as ${x.mode}`;
  }
</script>

{#if f && d}
  <section class="real" aria-labelledby="real-h" data-uid={d.uid}>
    <h3 id="real-h">The real light <span class="faint">(RDM)</span></h3>
    <div class="who"><b>{d.label || d.model || d.uid}</b> <small class="faint">{d.maker || 'Unknown maker'} · {d.model || `model ${d.modelId}`} · <span class="mono">{d.uid}</span></small></div>
    <dl>
      <dt>Address</dt><dd class:off={match?.problems.includes('address')}>{d.uni}.{span(d.addr, d.footprint)}
        {#if match?.problems.includes('address')}<small>(the patch says {f.universe}.{span(f.address, n)})</small>{/if}</dd>
      <dt>Mode</dt><dd class:off={match?.problems.includes('mode')}>{modeName}, {d.footprint} ch{d.modes > 1 ? ` (${d.mode} of ${d.modes})` : ''}
        {#if match?.problems.includes('mode')}<small>(the patch has {n})</small>{/if}</dd>
      <dt>Label</dt><dd>{d.label || '(none)'}</dd>
      <dt>Health</dt><dd class="h {health.level}">{health.text}{#each d.sensors.slice(0, 3) as s (s.name)} · {s.name} {s.value}{s.unit === 'C' ? ' °C' : ` ${s.unit}`}{/each}</dd>
    </dl>
    {#if match?.problems.includes('clash')}<p class="err small">It shares channels with another light on the rig.</p>{/if}
    <div class="acts">
      {#each fixes.filter((x) => x.kind !== 'patch') as x, i (i)}
        <button class={x.to === 'light' ? 'primary' : ''} disabled={busy || !ready} onclick={() => run(() => rig.apply(x), 'The light didn\'t take it: the rig\'s log says why')}
          title={x.to === 'light' ? 'Changes the real light over RDM (the show stays as it is)' : 'Changes the patch (the light stays as it is; Undo takes it back)'}>{label(x)}</button>
      {/each}
      {#if (d.modeList?.length ?? 0) > 1}
        <label class="inl">Light's mode <select aria-label="The light's mode" value={d.mode} disabled={busy || !ready}
          onchange={(e) => { const m = Number((e.target as HTMLSelectElement).value); void run(() => rig.setMode(d.uid, m), 'The light didn\'t change its mode'); }}>
          {#each d.modeList ?? [] as m (m.n)}<option value={m.n}>{m.name} ({m.footprint} ch)</option>{/each}
        </select></label>
      {/if}
      <button class="ghost" aria-pressed={d.identify} disabled={busy || !ready} onclick={() => run(() => rig.identify(d.uid, !d.identify), 'Identify didn\'t reach the light')} title="Makes the real light flash so you can find it">Identify</button>
      {#if d.label !== f.name}<button class="ghost" disabled={busy || !ready} onclick={() => run(() => rig.setLabel(d.uid, f.name), 'The light didn\'t take the name')} title="Writes this fixture's name into the light">Name it {f.name}</button>{/if}
      {#if !f.uid}<button class="ghost" onclick={() => rig.link(d.uid, f.id)} title="Found by its address: remembered, it's followed wherever its address goes">Remember it</button>{/if}
    </div>
  </section>
{:else if f?.uid}
  <section class="real" aria-labelledby="real-h">
    <h3 id="real-h">The real light <span class="faint">(RDM)</span></h3>
    <p class="small faint">It knows its light (<span class="mono">{f.uid}</span>), which {rig.devices.length ? "isn't answering on the rig right now" : 'the rig check hasn\'t looked for yet'}.
      {#if ready}<button class="ghost link" disabled={rig.scanning} onclick={() => rig.scan()}>{rig.scanning ? 'Scanning…' : 'Scan the rig'}</button>{:else}Connect its box to see it.{/if}</p>
  </section>
{/if}

<style>
  .real { grid-column: 1 / -1; display: flex; flex-direction: column; gap: .4rem; border: 1px solid var(--line); border-radius: var(--radius-s); padding: .55rem .7rem; background: var(--bg2); }
  h3 { margin: 0; font-size: .82rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .who small { display: inline; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .2rem .8rem; margin: 0; font-size: .88rem; }
  dt { color: var(--muted); } dd { margin: 0; }
  dd.off { color: var(--orange); } dd small { color: var(--muted); }
  .h.warning, .h.error { color: var(--orange); }
  .acts { display: flex; gap: .35rem; flex-wrap: wrap; align-items: center; }
  .inl { display: flex; align-items: center; gap: .4rem; color: var(--muted); font-size: .85rem; }
  .inl select { color: var(--text); }
  .small { margin: 0; font-size: .82rem; }
  .mono { font-family: ui-monospace, monospace; font-size: .8em; }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 0; min-width: 0; }
</style>
