<script lang="ts">
  // A moving light whose profile doesn't say which channels move it (a plain profile from RDM, a
  // file that got it wrong, a mirror scanner): try its channels on the real light, say which one
  // pans and which one tilts (a scanner or a moving bar may have only one), their fine channels
  // wherever they are, which one is its dimmer and which one opens its shutter (so it lights while
  // it's steered onto marks), how far pan and tilt go, and it's a head the app can aim, put in 3D
  // and calibrate. Saved for this light or for all of its type.
  import { onDestroy } from 'svelte';
  import Modal from './Modal.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { ATTR_LABEL } from './attrs';
  import { channelAt } from '../model/pixelLayout';
  import type { Channel, ChannelAttr } from '../model/types';

  let { id, onclose }: { id: string; onclose: () => void } = $props();
  const f = $derived(app.show.fixtures.find((x) => x.id === id));
  const t = $derived(f ? app.types.get(f.typeId) : undefined);
  const m = $derived(app.modeOf(id));
  const same = $derived(f ? app.show.fixtures.filter((x) => x.typeId === f.typeId) : []);

  type Role = 'pan' | 'tilt' | 'dim' | 'open';
  let roles = $state<Record<number, Role>>({});
  let panFine = $state(-1), tiltFine = $state(-1);
  let panDeg = $state(540), tiltDeg = $state(270);
  $effect.pre(() => { if (t?.physical?.panDeg) panDeg = t.physical.panDeg; if (t?.physical?.tiltDeg) tiltDeg = t.physical.tiltDeg; });
  const roleAt = (r: Role) => { const e = Object.entries(roles).find(([, x]) => x === r); return e ? +e[0] : -1; };
  const pan = $derived(roleAt('pan')), tilt = $derived(roleAt('tilt'));
  // (the channel right after, when its name says it's a fine one: "Pan fine", "Pan LSB", "16 bit")
  const fineName = (i: number) => /\bfine\b|\blsb\b|16.?bit/i.test(m?.channels[i]?.name ?? '');
  // (one channel per job; the same button again takes the job away)
  function give(i: number, r: Role) {
    const next: Record<number, Role> = { ...roles };
    if (next[i] === r) delete next[i];
    else { for (const [k, x] of Object.entries(next)) if (x === r) delete next[+k]; next[i] = r; }
    roles = next;
    if (r === 'pan') panFine = roles[i] === 'pan' && fineName(i + 1) ? i + 1 : -1;
    if (r === 'tilt') tiltFine = roles[i] === 'tilt' && fineName(i + 1) ? i + 1 : -1;
  }

  // trying it: a value per channel on the real light (the programmer, so Blind applies), let go
  // after, except what lights it (its dimmer and its shutter's open value stay up while it's open)
  const tried = $state<Record<number, number>>({});
  const live = (i: number) => { if (!f || !m) return 0; const w = channelAt(f, m, i); return app.frames.get(w.universe)?.[w.at] ?? 0; };
  function tryIt(i: number, v: number) { tried[i] = v; app.setRawOf(id, [[i, v]]); }
  function letGo() { const ks = Object.keys(tried).map(Number); if (ks.length) app.setRawOf(id, ks.map((i) => [i, undefined])); }
  onDestroy(letGo);

  const ok = $derived((pan >= 0 || tilt >= 0) && panDeg >= 10 && panDeg <= 1080 && tiltDeg >= 10 && tiltDeg <= 1080);
  function save(only: boolean) {
    if (!m || !ok) return;
    const chs: Channel[] = JSON.parse(JSON.stringify($state.snapshot(m.channels)));
    const plainName = (c: Channel) => /^(Channel \d+|.*unused.*)$/i.test(c.name);
    const set = (i: number, attr: ChannelAttr, name: string, extra: Partial<Channel> = {}) => {
      if (i < 0 || !chs[i]) return;
      const c: Channel = { ...chs[i], attr, ...extra };
      if (plainName(chs[i])) c.name = name;
      delete c.fine; delete c.ranges;
      chs[i] = { ...c, ...extra };
    };
    set(pan, 'pan', 'Pan', { default: 128 });
    set(tilt, 'tilt', 'Tilt', { default: 128 });
    if (panFine >= 0 && panFine !== tilt && pan >= 0) set(panFine, 'pan', 'Pan fine', { fine: true, default: 0 });
    if (tiltFine >= 0 && tiltFine !== pan && tilt >= 0) set(tiltFine, 'tilt', 'Tilt fine', { fine: true, default: 0 });
    set(roleAt('dim'), 'intensity', 'Dimmer');
    // the shutter: open at the value it's at now (a strobe channel resting there, 0 = no strobe above)
    const o = roleAt('open');
    if (o >= 0) set(o, 'strobe', 'Shutter', { default: tried[o] ?? live(o) });
    letGo();
    const said = app.changeChannels(id, chs, only, { panDeg, tiltDeg });
    app.toastUndo(`${said}: it ${pan >= 0 && tilt >= 0 ? 'pans and tilts' : pan >= 0 ? 'pans' : 'tilts'}`);
    onclose();
  }
  function calibrate(only: boolean) {
    const ids = only ? [id] : same.map((x) => x.id);
    save(only);
    ui.focusCal = ids;
  }
  const ROLES: [Role, string, string][] = [['pan', 'Pan', 'turns it left and right'], ['tilt', 'Tilt', 'tilts it up and down'], ['dim', 'Dimmer', 'makes it brighter'], ['open', 'Shutter', 'opens its shutter at the value it is at now (leave the slider where the light is on and steady)']];
  const fineChoices = $derived(m ? m.channels.map((c, i) => ({ i, label: `${i + 1}: ${c.name}` })) : []);
</script>

<Modal title="Find pan and tilt: {f?.name ?? ''}" {onclose} wide>
  {#if f && m}
    <p class="faint small">Move a slider and watch the light. Which channel turns it left and right (pan), which one up and down (tilt)? A scanner or a moving bar may have only one. Which one makes it brighter, and which one opens its shutter (leave that slider where the light is on and steady), so it lights while you steer it onto marks. The values go to the real light{app.output !== 'live' ? ' once you\'re on stage' : ''}.</p>
    <p class="faint small">One channel may reset the light or switch its lamp off: if it goes dark, put that slider back to 0.</p>
    {#if app.output !== 'live'}<p class="note" role="status">Blind: nothing reaches the light. <button class="ghost link" onclick={() => app.askOnStage()}>Go on stage</button></p>{/if}
    <table class="chs" aria-label="Its channels">
      <thead><tr><th>#</th><th>Name</th><th>Profile says</th><th>Try</th><th>This is</th></tr></thead>
      <tbody>
        {#each m.channels as c, i (i)}
          <tr class:on={roles[i] !== undefined}>
            <td class="faint">{i + 1}</td>
            <td>{c.name}</td>
            <td class="faint">{ATTR_LABEL[c.attr]?.split(' (')[0] ?? c.attr}</td>
            <td><input type="range" min="0" max="255" value={tried[i] ?? live(i)} aria-label="Try channel {i + 1}" oninput={(e) => tryIt(i, +(e.target as HTMLInputElement).value)} /></td>
            <td class="its">
              {#each ROLES as [r, label, what] (r)}<button class:on={roles[i] === r} aria-pressed={roles[i] === r} onclick={() => give(i, r)} title="This channel {what}" aria-label="Channel {i + 1} is {label}">{label}</button>{/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="row">
      {#if pan >= 0}<label>Pan fine <select bind:value={panFine} aria-label="Pan fine channel"><option value={-1}>none</option>{#each fineChoices.filter((x) => x.i !== pan && x.i !== tilt) as x (x.i)}<option value={x.i}>{x.label}</option>{/each}</select></label>{/if}
      {#if tilt >= 0}<label>Tilt fine <select bind:value={tiltFine} aria-label="Tilt fine channel"><option value={-1}>none</option>{#each fineChoices.filter((x) => x.i !== pan && x.i !== tilt) as x (x.i)}<option value={x.i}>{x.label}</option>{/each}</select></label>{/if}
    </div>
    <div class="row">
      <label>Pan goes <input type="number" min="10" max="1080" bind:value={panDeg} style="width:5em" aria-label="Pan range in degrees" />°</label>
      <label>Tilt goes <input type="number" min="10" max="1080" bind:value={tiltDeg} style="width:5em" aria-label="Tilt range in degrees" />°</label>
      <span class="faint small">from 0 to 255, as the manual says (most heads 540° and 270°). Not sure? Focus and calibrate with six marks, one at least 40 cm higher or lower than the rest, measures it.</span>
    </div>
    <div class="row foot">
      {#if !ok}<span class="faint small">{pan < 0 && tilt < 0 ? 'Which one is pan, which one tilt?' : 'Pan and tilt go 10° to 1080°.'}</span>{/if}
      <span style="flex:1"></span>
      <button onclick={onclose}>Cancel</button>
      <button onclick={() => save(true)} disabled={!ok}>For {f.name} only</button>
      {#if same.length > 1}<button onclick={() => save(false)} disabled={!ok}>For all {same.length} lights like it</button>{/if}
      <button class="primary" onclick={() => calibrate(same.length < 2)} disabled={!ok || pan < 0 || tilt < 0} title={pan < 0 || tilt < 0 ? 'Focus and calibrate needs pan and tilt' : ''}>{same.length > 1 ? `Save for all ${same.length}` : 'Save'} and focus on marks…</button>
    </div>
  {/if}
</Modal>

<style>
  .chs { width: 100%; border-collapse: collapse; font-size: .88rem; margin: .4rem 0; }
  .chs th { text-align: left; color: var(--muted); font-weight: 600; padding: .15rem .3rem; }
  .chs td { padding: .12rem .3rem; }
  .chs tr.on td { background: #ffaa1c14; }
  .chs input[type=range] { width: 100%; min-width: 80px; }
  .its { display: flex; flex-wrap: wrap; gap: .2rem; }
  .its button { padding: .1rem .45rem; font-size: .78rem; }
  .its button.on { border-color: var(--orange); color: var(--orange); }
  .row { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; margin: .3rem 0; }
  label { color: var(--muted); font-size: .88rem; display: inline-flex; gap: .3rem; align-items: center; }
  .note { color: #9fc0ff; font-size: .88rem; }
  .small { font-size: .82rem; }
  .foot { margin-top: .6rem; }
</style>
