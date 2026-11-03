<script lang="ts">
  // A light's setup, the way it's done at a real rig (the patch dialog's Mounting tab): how it's
  // mounted (presets and exact angles), a 3D picture of just those lights, test moves you watch on
  // the picture and, switched on, on the real lights (Home, pan and tilt to each end, the beam), the
  // head's invert, swap, range and offsets, a guided "point it at a mark" that works the offsets
  // out, and the same setup for a group (each keeps its own place). The sums: model/fixtureSetup.ts.
  import { onDestroy, untrack } from 'svelte';
  import { app } from '../app.svelte';
  import { typeLabel } from '../model/library';
  import { groundAt, roomOf, type Rot, type V3 } from '../stage3d/geometry';
  import {
    aimHead, copySetup, DIR_LABEL, dirOf, frontOf, frontsFor, marksOf, mirrorRot, motors, mountOf, mountRot, MOUNTS, offsetsFor, opticsOf, otherSide,
    placeFor, placeOf, pointOf, pointRot, POINTS, rigFixtureOf, upOf, withFront, type Dir, type Mark, type MountId, type PanTilt, type PlaceRule, type PointId,
  } from '../model/fixtureSetup';
  import type { Fixture, Resolved, Values } from '../model/types';

  let { id }: { id: string } = $props();
  const f = $derived(app.show.fixtures.find((x) => x.id === id));
  const kind = $derived(app.kinds[id] ?? 'other');
  const t = $derived(f ? app.types.get(f.typeId) : undefined);
  const room = $derived(roomOf(app.show.settings.stage3d?.room));
  const mover = $derived(kind === 'mover');
  const machine = $derived(kind === 'fog' || kind === 'sfx');
  const sortOf = (k: string) => (k === 'mover' ? 'mover' : k === 'fog' || k === 'sfx' ? 'machine' : 'fixed');
  const fx = (x: string) => app.show.fixtures.find((g) => g.id === x);
  const r1 = (v: number) => Math.round(v * 10) / 10 + 0;

  // ---- which lights: this one, or this one with others (the selection, its type, a group)
  const scopes = $derived.by(() => {
    if (!f) return [];
    const s: { key: string; label: string; ids: string[] }[] = [{ key: 'one', label: `${f.name} only`, ids: [f.id] }];
    if (app.selected.length > 1 && app.selected.includes(f.id)) s.push({ key: 'sel', label: `The ${app.selected.length} selected lights`, ids: [...app.selected] });
    const same = app.show.fixtures.filter((x) => x.typeId === f.typeId).map((x) => x.id);
    if (same.length > 1 && t) s.push({ key: 'type', label: `All ${same.length} ${typeLabel(t)}`, ids: same });
    for (const g of app.show.groups) if (g.fixtures.includes(f.id) && g.fixtures.length > 1) s.push({ key: `g:${g.id}`, label: `Group ${g.name} (${g.fixtures.length})`, ids: [...g.fixtures] });
    return s;
  });
  let scope = $state('one');
  const ids = $derived((scopes.find((s) => s.key === scope) ?? scopes[0])?.ids.filter((x) => fx(x)) ?? [id]);
  // the others take this light's mount only if they're the same sort of thing (a head's mount isn't a PAR's)
  const peers = $derived(ids.filter((x) => sortOf(app.kinds[x] ?? 'other') === sortOf(kind)));
  const others = $derived(peers.filter((x) => x !== id));
  let mirror = $state(true);

  // ---- where it is and how it hangs
  const place = $derived(f ? placeOf(f, kind, room) : undefined);
  const mount = $derived(place && mover ? mountOf(place.rot) : undefined);
  const front = $derived(place && mover ? dirOf(frontOf(place.rot)) : undefined);
  const fronts = $derived(place ? frontsFor(upOf(place.rot)) : []);
  const point = $derived(place && !mover && !machine ? pointOf(place.p, place.rot, room) : undefined);
  const where = $derived.by(() => {
    if (!place) return '';
    const p = place.p, ground = groundAt(p.x, p.z, room), h = p.y - ground, on = ground > 0 ? 'the stage' : 'the floor';
    const side = Math.abs(p.x) < 0.05 ? 'in the middle' : `${r1(Math.abs(p.x))} m ${p.x < 0 ? 'left' : 'right'} of the middle`;
    return `${Math.abs(h) < 0.05 ? `On ${on}` : `${r1(h)} m above ${on}`}, ${side} (seen from the audience)`;
  });

  // a turn for the lights: this one's, the others the same (mirrored on the other side when asked),
  // each moved onto its own truss or floor when the mount says so
  // (a turn worked out from where each light is: each gets its own, nothing mirrored)
  function turn(rot: Rot | ((p: V3, now: Rot) => Rot), rule: PlaceRule) {
    if (!f || !place) return;
    app.checkpoint();
    for (const x of peers) {
      const g = fx(x);
      if (!g) continue;
      const at = placeOf(g, app.kinds[x] ?? 'other', room), to = placeFor(rule, at.p, room);
      g.rot = typeof rot === 'function' ? rot(to, at.rot) : x !== id && mirror && otherSide(place.p.x, at.p.x) ? mirrorRot(rot) : { ...rot };
      // (its place on the plan stays: only the height and the truss it's on change)
      if (rule !== 'keep') g.p3 = to;
    }
    app.markDirty(0);
  }
  const setMount = (m: MountId) => place && turn(mountRot(m, place.rot), MOUNTS.find((x) => x.id === m)!.place);
  const setFront = (d: Dir) => place && turn(withFront(place.rot, d), 'keep');
  function setPoint(pt: PointId) {
    const rule = POINTS.find((x) => x.id === pt)!.place;
    if (place) turn(pt === 'stage' ? (p, now) => pointRot(pt, p, now, room) : pointRot(pt, place.p, place.rot, room), rule);
  }
  function setAngle(k: keyof Rot, v: number) {
    if (!place || !Number.isFinite(v)) return;
    turn({ ...place.rot, [k]: Math.max(-360, Math.min(360, r1(v))) }, 'keep');
  }

  // ---- pan and tilt: for every head in the set (the offsets are this one's own)
  function setFlag(k: 'invertPan' | 'invertTilt' | 'swapPanTilt', on: boolean) {
    app.checkpoint();
    for (const x of peers) { const g = fx(x); if (g) { if (on) g[k] = true; else delete g[k]; } }
    app.markDirty(0);
  }
  function setRange(k: 'panDeg' | 'tiltDeg', v: number) {
    app.checkpoint();
    for (const x of peers) { const g = fx(x); if (g) { if (Number.isFinite(v) && v >= 1 && v <= 1080) g[k] = Math.round(v); else delete g[k]; } }
    app.markDirty(0);
  }
  function setOffsets(o: { panOffset?: number; tiltOffset?: number }) {
    if (!f) return;
    app.checkpoint();
    for (const [k, v] of Object.entries(o) as ['panOffset' | 'tiltOffset', number][])
      if (Number.isFinite(v) && v) f[k] = Math.max(-360, Math.min(360, r1(v))); else delete f[k];
    app.markDirty(0);
  }

  // ---- trying it: what a cue would send, for each light in the set (the picture always; the real
  // lights too while that's on). Home is 50 % / 50 %.
  const HOME: PanTilt = { pan: 0.5, tilt: 0.5 };
  let test = $state<Record<string, PanTilt>>({});
  let beam = $state(true);
  let real = $state(false);
  const now = (x: string) => test[x] ?? HOME;
  const testable = $derived(ids.filter((x) => { const c = app.caps(x); return !c.fog && !c.sfx; }));
  const heads = $derived(testable.filter((x) => app.kinds[x] === 'mover'));
  function move(to: Partial<PanTilt>) { const n = { ...test }; for (const x of heads) n[x] = { ...now(x), ...to }; test = n; beam = true; }
  // the lights as the picture shows them (the motors' pan and tilt: swapped when the light says so)
  const lights = $derived(ids.map((x) => fx(x)).filter((g): g is Fixture => !!g).map((g) => rigFixtureOf(g, app.modeOf(g.id), app.kinds[g.id] ?? 'other', app.types.get(g.typeId), room)));
  const values = $derived.by(() => {
    const v: Record<string, Resolved> = {};
    for (const x of testable) {
      const g = fx(x);
      if (!g) continue;
      v[x] = { intensity: beam ? 1 : 0, color: { r: 1, g: 1, b: 1 }, ...(app.kinds[x] === 'mover' ? motors(g, now(x)) : {}) };
    }
    return v;
  });
  // On the real lights: in the programmer (so Blind, Blackout and the machine gate all apply as to
  // anything you do), and let go again when it's switched off or the setup closes: they go back to
  // what they had. Machines never get anything from here.
  const before = new Map<string, Values | undefined>();
  function letGo(keep: string[] = []) {
    for (const [x, v] of [...before]) {
      if (keep.includes(x)) continue;
      if (v) app.programmer[x] = v; else delete app.programmer[x];
      before.delete(x);
    }
  }
  $effect(() => {
    if (!real) { untrack(() => letGo()); return; }
    const want = testable.map((x) => {
      const c = app.caps(x), v: Values = {};
      if (app.kinds[x] === 'mover') Object.assign(v, now(x));
      if (c.intensity || c.color || c.white) v.intensity = beam ? 1 : 0;
      if (c.color && beam) v.color = { r: 1, g: 1, b: 1 };
      return [x, v] as const;
    });
    untrack(() => {
      letGo(want.map((w) => w[0]));
      for (const [x, v] of want) {
        if (!before.has(x)) before.set(x, app.programmer[x] ? $state.snapshot(app.programmer[x]) as Values : undefined);
        app.programmer[x] = { ...(before.get(x) ?? {}), ...v };
      }
    });
  });
  onDestroy(() => letGo());

  // ---- pointing it at a mark: aimed by the model, put right by hand on the real light, then the
  // offsets that make the model agree
  const marks = $derived(marksOf(room));
  let markOn = $state<Mark['id'] | null>(null);
  let step = $state(1);       // degrees per nudge
  let said = $state('');
  const optics = $derived(f ? opticsOf(f, t) : undefined);
  function aimMark(m: Mark) {
    if (!f || !place || !optics) return;
    markOn = m.id; said = '';
    const a = aimHead(f, place.p, place.rot, optics, m.p, now(id));
    if (!a) { said = `${f.name} can't reach that mark from where it is.`; return; }
    test = { ...test, [id]: a }; beam = true;
  }
  function nudge(dp: number, dt: number) {
    if (!optics) return;
    const c = now(id), cl = (v: number) => Math.max(0, Math.min(1, v));
    test = { ...test, [id]: { pan: cl(c.pan + dp * step / optics.panDeg), tilt: cl(c.tilt + dt * step / optics.tiltDeg) } };
    beam = true;
  }
  function onMark() {
    const m = marks.find((x) => x.id === markOn);
    if (!f || !place || !optics || !m) return;
    const o = offsetsFor(f, place.p, place.rot, optics, m.p, now(id));
    setOffsets(o);
    said = `Pan offset ${o.panOffset}°, tilt offset ${o.tiltOffset}°. The 3D stage and Aim now point it where it really goes: try another mark to check.`;
  }

  // ---- one light's setup for the others in the set
  let withOffsets = $state(false);
  function copyToOthers() {
    if (!f || !place) return;
    app.checkpoint();
    for (const x of others) {
      const g = fx(x);
      if (!g) continue;
      const at = placeOf(g, app.kinds[x] ?? 'other', room);
      copySetup(f, place.rot, g, { mirror: mirror && otherSide(place.p.x, at.p.x), offsets: withOffsets, pan: mover });
    }
    app.markDirty(0);
    app.toastUndo(`${others.length} light${others.length === 1 ? '' : 's'} set up like ${f.name}`);
  }
  const num = (e: Event) => (e.target as HTMLInputElement).valueAsNumber;
  const pct = (v: number) => `${r1(v * 100)} %`;
</script>

{#if f && place}
<div class="setup">
  <div class="view">
    {#await import('./FixtureSetup3D.svelte')}<p class="faint loading">Building the picture…</p>
    {:then M}<M.default {lights} {values} focus={id} {room} marks={mover ? marks.map((m) => ({ p: m.p, on: m.id === markOn })) : []} />
    {:catch}<p class="faint loading">No 3D picture here.</p>{/await}
    <p class="faint where">{where}</p>
  </div>

  <div class="ctl">
    {#if scopes.length > 1}
      <div class="line">
        <label class="inl">Set up <select value={scope} aria-label="Set up" onchange={(e) => (scope = (e.target as HTMLSelectElement).value)}>
          {#each scopes as s (s.key)}<option value={s.key}>{s.label}</option>{/each}</select></label>
        {#if others.length}<label class="ck" title="A light on the other side of the stage's middle gets the mirror image: on its side on the left becomes on its side on the right">
          <input type="checkbox" bind:checked={mirror} /> mirror the other side</label>{/if}
      </div>
      {#if others.length}<p class="faint small">What you change here goes to all {peers.length} (each keeps its own place). The offsets are {f.name}'s own.</p>{/if}
    {/if}

    <section aria-labelledby="mnt-h">
      <h3 id="mnt-h">{machine ? 'How it stands' : mover ? 'How it is mounted' : 'Where it points'}</h3>
      {#if mover}
        <div class="seg" role="group" aria-label="How it is mounted">
          {#each MOUNTS as m (m.id)}<button aria-pressed={mount === m.id} class:on={mount === m.id} title={m.hint} onclick={() => setMount(m.id)}>{m.label}</button>{/each}
        </div>
        <label class="inl">Its front (the side with the display) faces
          <select aria-label="Its front faces" value={front ?? ''} onchange={(e) => setFront((e.target as HTMLSelectElement).value as Dir)}>
            {#if !front}<option value="">turned (see the angles)</option>{/if}
            {#each fronts as d (d)}<option value={d}>{DIR_LABEL[d]}</option>{/each}
          </select></label>
        <p class="faint small">At pan 50 % a head tilts towards its front: most point their beam there.</p>
      {:else if !machine}
        <div class="seg" role="group" aria-label="Where it points">
          {#each POINTS as p (p.id)}<button aria-pressed={point === p.id} class:on={point === p.id} title={p.hint} onclick={() => setPoint(p.id)}>{p.label}</button>{/each}
        </div>
      {/if}
      <div class="angles">
        {#each [['yaw', 'Turn °', 'Turned about the vertical'], ['pitch', 'Tip °', 'Tipped forwards (towards the audience) or back'], ['roll', 'Roll °', 'Rolled to the side; 180 is upside down']] as [k, label, tip] (k)}
          <label title={tip}>{label}<input type="number" step="5" min="-360" max="360" aria-label={label.replace(' °', '')} value={place.rot[k as keyof Rot]}
            onchange={(e) => setAngle(k as keyof Rot, num(e))} /></label>
        {/each}
      </div>
      {#if machine}<p class="faint small">Machines aren't tried from here: nothing is sent to them.</p>{/if}
    </section>

    {#if testable.length}
      <section aria-labelledby="try-h">
        <h3 id="try-h">Try it</h3>
        <div class="seg wrap" role="group" aria-label="Test moves">
          {#if heads.length}
            <button onclick={() => move(HOME)} title="Pan and tilt to 50 %: where it points with nothing else going on">Home</button>
            <button onclick={() => move({ pan: 0 })}>Pan to 0 %</button>
            <button onclick={() => move({ pan: 1 })}>Pan to 100 %</button>
            <button onclick={() => move({ tilt: 0 })}>Tilt to 0 %</button>
            <button onclick={() => move({ tilt: 1 })}>Tilt to 100 %</button>
          {/if}
          <button aria-pressed={beam} class:on={beam} onclick={() => (beam = !beam)} title="Full and white, or dark">Beam</button>
        </div>
        <label class="ck"><input type="checkbox" bind:checked={real} /> On the real lights too</label>
        {#if real && app.output === 'blind'}
          <p class="note" role="status">Blind: nothing new goes out, the lights keep their look.
            <button class="ghost link" onclick={() => app.askOnStage()}>Go on stage</button></p>
        {:else if real}
          <p class="faint small" role="status">The lights in the set do it too. Closing this (or switching it off) gives them back what they had.</p>
        {/if}
        {#if heads.length}<p class="faint small">Watch the real head: it should do what the picture does. Turns the other way: invert. Tilts when it should pan: swap.</p>{/if}
      </section>
    {/if}

    {#if mover}
      <section aria-labelledby="pt-h">
        <h3 id="pt-h">Pan and tilt</h3>
        <div class="flags">
          <label class="ck"><input type="checkbox" checked={!!f.invertPan} onchange={(e) => setFlag('invertPan', (e.target as HTMLInputElement).checked)} /> Invert pan</label>
          <label class="ck"><input type="checkbox" checked={!!f.invertTilt} onchange={(e) => setFlag('invertTilt', (e.target as HTMLInputElement).checked)} /> Invert tilt</label>
          <label class="ck" title="What a cue sends as pan goes to its tilt channel, and tilt to pan"><input type="checkbox" checked={!!f.swapPanTilt} onchange={(e) => setFlag('swapPanTilt', (e.target as HTMLInputElement).checked)} /> Swap pan and tilt</label>
        </div>
        <div class="angles">
          <label title="How far it pans from 0 % to 100 %, from the manual">Pan range °<input type="number" min="1" max="1080" step="1" aria-label="Pan range" value={f.panDeg ?? ''}
            placeholder={t?.physical?.panDeg ? `${t.physical.panDeg} (its type)` : '540 (a guess)'} onchange={(e) => setRange('panDeg', num(e))} /></label>
          <label title="How far it tilts from 0 % to 100 %, from the manual">Tilt range °<input type="number" min="1" max="1080" step="1" aria-label="Tilt range" value={f.tiltDeg ?? ''}
            placeholder={t?.physical?.tiltDeg ? `${t.physical.tiltDeg} (its type)` : '270 (a guess)'} onchange={(e) => setRange('tiltDeg', num(e))} /></label>
        </div>
        <div class="angles">
          <label title="Where pan 50 % really points, in degrees (Aim and the 3D stage use it)">Pan offset °<input type="number" min="-360" max="360" step="1" aria-label="Pan offset" value={f.panOffset ?? 0}
            onchange={(e) => setOffsets({ panOffset: num(e) })} /></label>
          <label title="Where tilt 50 % really points, in degrees">Tilt offset °<input type="number" min="-180" max="180" step="1" aria-label="Tilt offset" value={f.tiltOffset ?? 0}
            onchange={(e) => setOffsets({ tiltOffset: num(e) })} /></label>
        </div>
      </section>

      <section aria-labelledby="mk-h">
        <h3 id="mk-h">Point {f.name} at a mark</h3>
        <p class="faint small">Pick a mark (a bit of tape on the real stage), the head goes where the picture thinks it is; nudge it until the real beam is on the mark, then say so.</p>
        <div class="seg wrap" role="group" aria-label="Marks">
          {#each marks as m (m.id)}<button aria-pressed={markOn === m.id} class:on={markOn === m.id} title={m.where} onclick={() => aimMark(m)}>{m.label}</button>{/each}
        </div>
        {#if markOn}
          {@const m = marks.find((x) => x.id === markOn)}
          {#if m}<p class="faint small">{m.label}: {m.where}.</p>{/if}
          <div class="nudge" role="group" aria-label="Nudge the head">
            <button onclick={() => nudge(-1, 0)}>Pan −</button>
            <button onclick={() => nudge(1, 0)}>Pan +</button>
            <button onclick={() => nudge(0, -1)}>Tilt −</button>
            <button onclick={() => nudge(0, 1)}>Tilt +</button>
            <label class="inl">by <select aria-label="Nudge by" bind:value={step}><option value={1}>1°</option><option value={5}>5°</option><option value={0.2}>0.2°</option></select></label>
          </div>
          <p class="faint small mono">pan {pct(now(id).pan)}, tilt {pct(now(id).tilt)}{#if !real} · switch on "On the real lights too" to see the real one{/if}</p>
          <button class="primary" onclick={onMark}>It's on the mark</button>
        {/if}
        {#if said}<p class="small" role="status">{said}</p>{/if}
      </section>
    {/if}

    {#if others.length}
      <section aria-labelledby="cp-h">
        <h3 id="cp-h">The others</h3>
        <div class="line">
          <button onclick={copyToOthers}>Make the other {others.length} like {f.name}</button>
          {#if mover}<label class="ck" title="Each head is usually a little different: point each one at a mark instead"><input type="checkbox" bind:checked={withOffsets} /> with its offsets</label>{/if}
        </div>
      </section>
    {/if}
  </div>
</div>
{/if}

<style>
  .setup { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(280px, 1fr); gap: 1rem; align-items: start; }
  @media (max-width: 760px) { .setup { grid-template-columns: 1fr; } }
  .view { position: sticky; top: 0; display: flex; flex-direction: column; gap: .3rem; height: min(420px, 55vh); }
  .view > :global(.p3) { flex: 1; }
  .loading { margin: auto; }
  .where { margin: 0; font-size: .8rem; }
  .ctl { display: flex; flex-direction: column; gap: .8rem; min-width: 0; }
  section { display: flex; flex-direction: column; gap: .45rem; }
  h3 { margin: 0; font-size: .82rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .seg { display: flex; gap: .25rem; flex-wrap: wrap; }
  .seg button { padding: .25rem .6rem; font-size: .85rem; }
  .seg button.on { background: var(--orange); color: #1a1000; border-color: var(--orange); }
  .angles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
  .angles label { display: flex; flex-direction: column; gap: .2rem; color: var(--muted); font-size: .8rem; min-width: 0; }
  .angles input { width: 100%; min-width: 0; color: var(--text); }
  .flags { display: flex; flex-wrap: wrap; gap: .3rem 1rem; }
  .ck { display: flex; align-items: center; gap: .4rem; color: var(--text); font-size: .88rem; }
  .inl { display: flex; align-items: center; gap: .4rem; color: var(--muted); font-size: .85rem; flex-wrap: wrap; }
  .inl select { color: var(--text); }
  .line { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .small { margin: 0; font-size: .8rem; }
  .note { margin: 0; font-size: .85rem; color: var(--orange); }
  .nudge { display: flex; gap: .25rem; flex-wrap: wrap; align-items: center; }
  .nudge button { padding: .25rem .55rem; font-size: .85rem; }
  .mono { font-variant-numeric: tabular-nums; }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 0; min-width: 0; }
</style>
