<script lang="ts">
  // A light's mode, channel by channel (the patch dialog's Channels tab), to hold next to the DMX
  // table in its manual: number, address, what it does, fine channels with their coarse one, the
  // default, the wheel's slots. Its other modes say plainly what picking one does: the channel
  // count, and which lights after it move to make room (or what's freed).
  import { app } from '../app.svelte';
  import { ATTR_LABEL } from './attrs';
  import { channelRows, modeChange, type PatchedLight } from '../model/fixtureSetup';

  let { id }: { id: string } = $props();
  const f = $derived(app.show.fixtures.find((x) => x.id === id));
  const t = $derived(f ? app.types.get(f.typeId) : undefined);
  const m = $derived(app.modeOf(id));
  const rows = $derived(m && f ? channelRows(m, f.address) : []);
  const patched = $derived(app.show.fixtures.map((x): PatchedLight => ({ id: x.id, name: x.name, universe: x.universe, address: x.address, channels: app.modeOf(x.id)?.channels.length ?? 1 })));
  const others = $derived(t && m ? t.modes.filter((x) => x.name !== m.name).map((x) => ({ mode: x, c: modeChange(patched, id, x.channels.length) })) : []);
  const hex = (v: number) => `${v}`;

  function use(name: string, moves: { id: string; to: number }[]) {
    if (!f) return;
    app.checkpoint();
    f.mode = name;
    for (const mv of moves) { const g = app.show.fixtures.find((x) => x.id === mv.id); if (g) g.address = mv.to; }
    app.markDirty(0);
    app.toastUndo(`${f.name} now in ${name}${moves.length ? `; ${moves.length} light${moves.length === 1 ? '' : 's'} after it moved up` : ''}`);
  }
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
</script>

{#if f && m}
  <div class="chan">
    <p class="sum"><b>{m.name}</b>: {plural(m.channels.length, 'channel')}, {f.universe}.{f.address}{m.channels.length > 1 ? ` to ${f.address + m.channels.length - 1}` : ''}.
      <span class="faint">Check it against the DMX table in the light's manual (the light must be set to the same mode).</span></p>
    <div class="tw">
      <table aria-label="The channels of {m.name}">
        <thead><tr><th scope="col">Ch</th><th scope="col">DMX</th><th scope="col">Name</th><th scope="col">Does</th><th scope="col">Default</th><th scope="col">Slots / ranges</th></tr></thead>
        <tbody>
          {#each rows as r (r.n)}
            <tr class:fine={r.fineOf}>
              <td class="n">{r.n}</td><td class="n">{r.dmx}</td><td>{r.name}</td>
              <td>{#if r.fineOf}fine, with channel {r.fineOf} (16 bit){:else}{ATTR_LABEL[r.attr] ?? r.attr}{/if}{#if r.span}<small class="faint"> (uses {r.span[0]} to {r.span[1]})</small>{/if}</td>
              <td class="n">{hex(r.def)}</td>
              <td class="rg">{#each r.ranges as g, i (i)}<span class="slot" title="{g.from} to {g.to}">{#if g.color}<i style="background:{g.color}"></i>{/if}{g.label || '…'} <small class="faint">{g.from}–{g.to}</small></span>{/each}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

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
  .tw { max-height: 52vh; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-s); }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th { position: sticky; top: 0; background: var(--panel2); text-align: left; color: var(--muted); font-weight: 600; padding: .3rem .5rem; }
  td { padding: .25rem .5rem; border-top: 1px solid var(--line); vertical-align: top; }
  td.n { font-variant-numeric: tabular-nums; text-align: right; width: 3em; }
  tr.fine td { color: var(--muted); }
  .rg { display: flex; flex-wrap: wrap; gap: .2rem .6rem; }
  .slot { white-space: nowrap; }
  .slot i { display: inline-block; width: .75em; height: .75em; border-radius: 50%; margin-right: .25em; vertical-align: -.05em; border: 1px solid #fff4; }
  h3 { margin: .3rem 0 0; font-size: .82rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .modes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .4rem; }
  .modes li { display: grid; grid-template-columns: minmax(8em, auto) 1fr auto; gap: .6rem; align-items: center; border: 1px solid var(--line); border-radius: var(--radius-s); padding: .4rem .6rem; }
  @media (max-width: 640px) { .modes li { grid-template-columns: 1fr; } }
  .what { font-size: .85rem; }
  .acts { display: flex; gap: .3rem; flex-wrap: wrap; justify-content: flex-end; }
  .err { color: var(--orange); }
</style>
