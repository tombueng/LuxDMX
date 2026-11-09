<script lang="ts">
  // Focus and calibrate moving heads (a head's menu), the way it's done at a real rig: tape a few
  // marks on the stage, steer each head onto each mark by hand, and the app works out where every
  // head really hangs, how it's turned and its offsets (model/calibrate.ts). After that Aim and the
  // 3D stage point them right, and ten heads meet on one spot. What was steered can also be kept as
  // a position preset per mark (focus palettes): cues that use them follow when the rig is focused
  // again at the next venue.
  import { onDestroy, untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import { app, newId } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { groundAt, roomOf, worldToPlan } from '../stage3d/geometry';
  import { aimHead, calMarks, motors, opticsOf, placeOf, upOf, type PanTilt } from '../model/fixtureSetup';
  import { solvePose, type Fit } from '../model/calibrate';
  import type { Fixture, StageMark, Values } from '../model/types';

  let { ids, onclose }: { ids: string[]; onclose: () => void } = $props();
  const room = $derived(roomOf(app.show.settings.stage3d?.room));
  const heads = $derived(ids.map((x) => app.show.fixtures.find((f) => f.id === x)).filter((f): f is Fixture => !!f && app.kinds[f.id] === 'mover'));
  $effect(() => { if (!heads.length) onclose(); });
  const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
  const num = (e: Event) => (e.target as HTMLInputElement).valueAsNumber;
  const HOME: PanTilt = { pan: 0.5, tilt: 0.5 };

  // ---- the marks: the show's own, else the room's suggestion (kept once one is changed)
  const marks = $derived(app.show.settings.marks?.length ? app.show.settings.marks : calMarks(room));
  const front = $derived(room.deck.x > 0 ? room.deck.z1 : room.zc + room.D / 2);
  function setMarks(next: StageMark[]) { app.checkpoint(); app.show.settings.marks = next; app.markDirty(0); }
  const copyMarks = () => JSON.parse(JSON.stringify($state.snapshot(marks))) as StageMark[];
  function editMark(i: number, k: 'across' | 'back' | 'height' | 'name', v: number | string) {
    const next = copyMarks(), m = next[i];
    if (!m) return;
    if (k === 'name') { m.name = String(v).trim() || m.name; }
    else if (typeof v === 'number' && Number.isFinite(v)) {
      if (k === 'across') m.p.x = r2(v);
      else if (k === 'back') m.p.z = r2(front - v);
      else m.p.y = r2(v);
    } else return;
    setMarks(next);
  }
  function addMark() { setMarks([...copyMarks(), { id: newId('m'), name: `Mark ${marks.length + 1}`, p: { x: 0, y: groundAt(0, room.zc, room), z: r2(room.zc) } }]); }
  function removeMark(i: number) { const next = copyMarks(); next.splice(i, 1); if (next.length) setMarks(next); }
  function roomMarks() { app.checkpoint(); delete app.show.settings.marks; app.markDirty(0); }
  let mi = $state(0);
  const mark = $derived(marks[Math.min(mi, marks.length - 1)]);

  // ---- steering: each head's pan and tilt (what a cue sends), aimed by the show at a new mark
  let hi = $state(untrack(() => ids[0]));
  const head = $derived(heads.find((f) => f.id === hi) ?? heads[0]);
  let pt = $state<Record<string, PanTilt>>({});
  const optics = (f: Fixture) => opticsOf(f, app.types.get(f.typeId));
  const seenAt = (fid: string, mid: string) => ui.calSeen[fid]?.[mid];
  function aimAll() {
    if (!mark) return;
    const n = { ...pt };
    for (const f of heads) {
      const s = seenAt(f.id, mark.id);
      if (s) { n[f.id] = { ...s }; continue; }
      const pl = placeOf(f, 'mover', room);
      n[f.id] = aimHead(f, pl.p, pl.rot, optics(f), mark.p, pt[f.id] ?? HOME) ?? pt[f.id] ?? HOME;
    }
    pt = n;
  }
  $effect(() => { void [mark?.id, mark?.p.x, mark?.p.y, mark?.p.z]; untrack(aimAll); });
  let step = $state(1);
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  function nudge(dp: number, dt: number) {
    if (!head) return;
    const o = optics(head), v = pt[head.id] ?? HOME;
    // (a cue's pan drives the tilt motor on a swapped head: its step is the tilt motor's)
    const pr = head.swapPanTilt ? o.tiltDeg : o.panDeg, tr = head.swapPanTilt ? o.panDeg : o.tiltDeg;
    pt = { ...pt, [head.id]: { pan: clamp01(v.pan + (dp * step) / pr), tilt: clamp01(v.tilt + (dt * step) / tr) } };
  }
  function setPct(k: 'pan' | 'tilt', v: number) { if (head && Number.isFinite(v)) pt = { ...pt, [head.id]: { ...(pt[head.id] ?? HOME), [k]: clamp01(v / 100) } }; }
  function keys(e: KeyboardEvent) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] }[e.key];
    if (!d || (e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    nudge(d[0], d[1]);
  }
  let said = $state('');
  function onMark() {
    if (!head || !mark) return;
    ui.calSeen = { ...ui.calSeen, [head.id]: { ...(ui.calSeen[head.id] ?? {}), [mark.id]: { ...(pt[head.id] ?? HOME) } } };
    // on to the next head that hasn't been on this mark yet
    const next = heads.find((f) => !seenAt(f.id, mark.id));
    if (next) hi = next.id;
    said = next ? '' : `All ${heads.length} on ${mark.name}. Pick the next mark.`;
  }
  function forget(fid: string, mid: string) { const s = { ...(ui.calSeen[fid] ?? {}) }; delete s[mid]; ui.calSeen = { ...ui.calSeen, [fid]: s }; }
  const count = (fid: string) => marks.filter((m) => seenAt(fid, m.id)).length;

  // ---- on the real heads: in the programmer (Blind and Blackout apply as to anything you do);
  // let go when it's switched off or this closes
  let real = $state(false);
  let solo = $state(true);
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
    const want = heads.map((f) => {
      const c = app.caps(f.id), on = !solo || f.id === head?.id, v: Values = { ...(pt[f.id] ?? HOME) };
      if (c.intensity || c.color || c.white) v.intensity = on ? 1 : 0;
      if (c.color) v.color = { r: 1, g: 1, b: 1 };
      return [f.id, v] as const;
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

  // ---- working it out, and using it
  let results = $state<Record<string, Fit | undefined>>({});
  const ready = $derived(heads.filter((f) => count(f.id) >= 3));
  function workOut() {
    const out: Record<string, Fit | undefined> = {};
    for (const f of ready) {
      const o = optics(f), pl = placeOf(f, 'mover', room);
      const seen = marks.flatMap((m) => { const s = seenAt(f.id, m.id); if (!s) return []; const v = motors(f, s); return [{ mark: m.p, pan: v.pan, tilt: v.tilt }]; });
      out[f.id] = solvePose({ p: pl.p, rot: pl.rot, panOffset: o.panOffset, tiltOffset: o.tiltOffset, invertPan: o.invertPan, invertTilt: o.invertTilt, panReversed: !!f.panReversed, tiltReversed: !!f.tiltReversed }, o, seen);
    }
    results = out;
  }
  // (its up, from the fit, more than 60° from where the show had it)
  const turnedOver = (f: Fixture, r: Fit) => { const a = upOf(placeOf(f, 'mover', room).rot), b = upOf(r.rot); return a.x * b.x + a.y * b.y + a.z * b.z < 0.5; };
  const worstMark = (f: Fixture, r: Fit) => { const seen = marks.filter((m) => seenAt(f.id, m.id)); return seen[r.errs.indexOf(r.worst)]?.name ?? ''; };
  const cm = (m: number) => `${Math.max(1, Math.round(m * 100))} cm`;
  const placeWords = (r: Fit) => `${r2(Math.abs(r.p.x))} m ${r.p.x < 0 ? 'left' : 'right'} of the middle, ${r2(r.p.y)} m up, ${r2(Math.abs(front - r.p.z))} m ${r.p.z <= front ? 'behind' : 'in front of'} the front edge`;
  function apply() {
    const done = heads.filter((f) => results[f.id]);
    if (!done.length) return;
    app.checkpoint();
    for (const f of done) {
      const r = results[f.id]!;
      f.p3 = { ...r.p }; f.rot = { ...r.rot };
      if (r.panOffset) f.panOffset = r.panOffset; else delete f.panOffset;
      if (r.tiltOffset) f.tiltOffset = r.tiltOffset; else delete f.tiltOffset;
      if (r.panReversed) f.panReversed = true; else delete f.panReversed;
      if (r.tiltReversed) f.tiltReversed = true; else delete f.tiltReversed;
      const pl = worldToPlan(r.p.x, r.p.z, room);
      f.x = pl.x; f.y = pl.y;
    }
    app.markDirty(0);
    app.toastUndo(`${done.length} head${done.length === 1 ? '' : 's'} now where the marks say: Aim and the 3D stage use it`);
    results = {};
    aimAll();
  }
  // each mark as a position preset, every head's own pan and tilt in it (updated when it's there)
  function presets() {
    let n = 0;
    app.checkpoint();
    for (const m of marks) {
      const per: Record<string, Values> = {};
      for (const f of heads) { const s = seenAt(f.id, m.id); if (s) per[f.id] = { pan: s.pan, tilt: s.tilt }; }
      const fids = Object.keys(per);
      if (!fids.length) continue;
      let p = app.show.presets.find((x) => x.kind === 'position' && x.name === m.name);
      if (!p) { app.show.presets.push({ id: newId('p'), name: m.name, kind: 'position', values: { ...per[fids[0]] } }); p = app.show.presets[app.show.presets.length - 1]; }
      p.perFixture = { ...(p.perFixture ?? {}), ...per };
      n++;
    }
    app.markDirty(0);
    app.engine.refresh();
    app.toastUndo(n ? `${n} position preset${n === 1 ? '' : 's'}, one per mark: cues that use them follow when you focus again` : 'No head is on a mark yet');
  }

  // ---- the little plan: the deck from above (the audience at the bottom), the marks, the heads
  const W = $derived(room.W + 2), Z0 = $derived(room.zc - room.D / 2 - 1), Z1 = $derived(Math.max(front, room.zc + room.D / 2) + 1);
  const px = (x: number) => x + W / 2, pz = (z: number) => z - Z0;
</script>

<Modal title="Focus and calibrate: {heads.length === 1 ? heads[0].name : `${heads.length} heads`}" {onclose} wide>
  <div class="cal">
    <div class="left">
      <p class="faint small">Tape the marks on the real stage, steer every head onto every mark, and the app works out where each one really hangs. Four marks, spread out, are best; three do.</p>
      <svg viewBox="0 0 {W} {Z1 - Z0}" class="plan" role="img" aria-label="The stage from above, the audience at the bottom">
        {#if room.deck.x > 0}<rect x={px(-room.deck.x)} y={pz(room.deck.z0)} width={room.deck.x * 2} height={room.deck.z1 - room.deck.z0} class="deck" />{/if}
        {#each marks as m, i (m.id)}
          <g class="mk" class:on={i === mi}><path d="M{px(m.p.x) - 0.35} {pz(m.p.z)}h0.7M{px(m.p.x)} {pz(m.p.z) - 0.35}v0.7" /><text x={px(m.p.x) + 0.3} y={pz(m.p.z) - 0.3}>{i + 1}</text></g>
        {/each}
        {#each heads as f (f.id)}
          {@const pl = placeOf(f, 'mover', room)}
          <circle cx={px(pl.p.x)} cy={pz(pl.p.z)} r="0.22" class="hd" class:cur={f.id === head?.id} />
          {#if results[f.id]}<circle cx={px(results[f.id]!.p.x)} cy={pz(results[f.id]!.p.z)} r="0.3" class="fit" />{/if}
        {/each}
      </svg>
      <table class="marks" aria-label="The marks">
        <thead><tr><th>#</th><th>Name</th><th title="Metres right of the middle, seen from the audience (left is minus)">Across m</th><th title="Metres back from the stage's front edge">Back m</th><th title="Metres above the floor">Up m</th><th></th></tr></thead>
        <tbody>
          {#each marks as m, i (m.id)}
            <tr class:on={i === mi}>
              <td>{i + 1}</td>
              <td><input value={m.name} aria-label="Mark {i + 1} name" onchange={(e) => editMark(i, 'name', (e.target as HTMLInputElement).value)} /></td>
              <td><input type="number" step="0.05" value={m.p.x} aria-label="Mark {i + 1} across" onchange={(e) => editMark(i, 'across', num(e))} /></td>
              <td><input type="number" step="0.05" value={r2(front - m.p.z)} aria-label="Mark {i + 1} back from the front" onchange={(e) => editMark(i, 'back', num(e))} /></td>
              <td><input type="number" step="0.05" value={m.p.y} aria-label="Mark {i + 1} height" onchange={(e) => editMark(i, 'height', num(e))} /></td>
              <td><button class="ghost x" aria-label="Remove mark {i + 1}" onclick={() => removeMark(i)} disabled={marks.length < 2}>×</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="row"><button onclick={addMark}>+ Mark</button>{#if app.show.settings.marks?.length}<button class="ghost" onclick={roomMarks}>The room's marks again</button>{/if}</div>
    </div>

    <div class="right">
      <section aria-labelledby="cal-mark-h">
        <h3 id="cal-mark-h">1. A mark</h3>
        <div class="seg" role="radiogroup" aria-label="Mark">
          {#each marks as m, i (m.id)}<button role="radio" aria-checked={i === mi} class:on={i === mi} onclick={() => (mi = i)}>{i + 1} {m.name}</button>{/each}
        </div>
        <p class="faint small">The heads start where the show thinks the mark is. Some will be off: that's what this is for.</p>
      </section>

      <section aria-labelledby="cal-head-h">
        <h3 id="cal-head-h">2. Each head onto it</h3>
        <ul class="heads" role="radiogroup" aria-label="Head">
          {#each heads as f (f.id)}
            {@const s = mark && seenAt(f.id, mark.id)}
            <li><button role="radio" aria-checked={f.id === head?.id} class:on={f.id === head?.id} onclick={() => (hi = f.id)}>
              <span>{f.name}</span><span class="faint">{s ? '✓ on it' : ''} {count(f.id)} of {marks.length}</span></button>
              {#if s}<button class="ghost x" title="Forget this one" aria-label="Forget {f.name} on {mark?.name}" onclick={() => mark && forget(f.id, mark.id)}>×</button>{/if}</li>
          {/each}
        </ul>
        {#if head}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions (the arrow keys are a shortcut: every step has its button) -->
          <div class="steer" role="group" aria-label="Steer {head.name}" tabindex="-1" onkeydown={keys}>
            <div class="pads">
              <button onclick={() => nudge(-1, 0)} aria-label="Pan minus">◀ Pan</button>
              <button onclick={() => nudge(1, 0)} aria-label="Pan plus">Pan ▶</button>
              <button onclick={() => nudge(0, 1)} aria-label="Tilt plus">▲ Tilt</button>
              <button onclick={() => nudge(0, -1)} aria-label="Tilt minus">▼ Tilt</button>
              <select bind:value={step} aria-label="Step"><option value={0.2}>0.2°</option><option value={1}>1°</option><option value={5}>5°</option></select>
            </div>
            <div class="pct">
              <label>Pan % <input type="number" step="0.01" min="0" max="100" aria-label="Pan %" value={r2((pt[head.id] ?? HOME).pan * 100)} onchange={(e) => setPct('pan', num(e))} /></label>
              <label>Tilt % <input type="number" step="0.01" min="0" max="100" aria-label="Tilt %" value={r2((pt[head.id] ?? HOME).tilt * 100)} onchange={(e) => setPct('tilt', num(e))} /></label>
            </div>
            <p class="faint small">The arrow keys steer it too (click here first).</p>
            <button class="primary" onclick={onMark}>{head.name} is on {mark?.name}</button>
          </div>
        {/if}
        <label class="ck"><input type="checkbox" bind:checked={real} /> On the real heads</label>
        <label class="ck"><input type="checkbox" bind:checked={solo} /> Only the one I'm steering is lit</label>
        {#if real && app.output === 'blind'}
          <p class="note" role="status">Blind: nothing new goes out. <button class="ghost link" onclick={() => app.askOnStage()}>Go on stage</button></p>
        {/if}
        {#if said}<p class="said" role="status">{said}</p>{/if}
      </section>

      <section aria-labelledby="cal-out-h">
        <h3 id="cal-out-h">3. Where they really hang</h3>
        <div class="row">
          <button onclick={workOut} disabled={!ready.length}>Work it out{ready.length ? ` for ${ready.length}` : ''}</button>
          <button class="ghost" onclick={presets} title="One position preset per mark, with each head's own pan and tilt: the way consoles keep a focus">Keep the marks as position presets</button>
        </div>
        {#if !ready.length}<p class="faint small">A head needs three marks (four for its tilt offset too).</p>{/if}
        {#if Object.keys(results).length}
          <ul class="results" aria-label="Results">
            {#each heads as f (f.id)}
              {@const r = results[f.id]}
              {#if r}
                <li data-head={f.name}>
                  <b>{f.name}</b>: {placeWords(r)}. Turned {r2(r.rot.yaw)}° / {r2(r.rot.pitch)}° / {r2(r.rot.roll)}°, pan offset {r2(r.panOffset)}°, tilt offset {r2(r.tiltOffset)}°.
                  <span class={r.worst < 0.1 ? 'good' : 'bad'}>{r.worst < 0.1 ? `Fits all its marks within ${cm(r.worst)}.` : `${worstMark(f, r)} is ${cm(r.worst)} off: steer it there again, or check where that mark really is.`}</span>
                  {#if !!r.panReversed !== !!f.panReversed}<span class="bad">Its pan turns the other way round from what its type says: Use it puts the picture and Aim right (nothing changes on the wire).</span>{/if}
                  {#if r.twin}<span class="bad">The marks are all at one height, so its mirror image (on the other side of them, its pan the other way round) fits them as well: this is the likelier one. Give one mark another height (a box on the stage, the riser) and steer it there to be sure.</span>{/if}
                  {#if turnedOver(f, r)}<span class="bad">It points as if it hung quite differently from what the show says (turned over): Use it puts it that way, so Aim gets it right. Worth a look at how it really hangs.</span>{/if}
                </li>
              {:else if count(f.id) >= 3}<li><b>{f.name}</b>: no fit.</li>{/if}
            {/each}
          </ul>
          <button class="primary" onclick={apply}>Use it</button>
        {/if}
      </section>
    </div>
  </div>
</Modal>

<style>
  .cal { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.2fr); gap: 1rem; align-items: start; }
  @media (max-width: 760px) { .cal { grid-template-columns: 1fr; } }
  .left, .right { display: flex; flex-direction: column; gap: .7rem; min-width: 0; }
  section { display: flex; flex-direction: column; gap: .45rem; align-items: flex-start; }
  h3 { margin: 0; font-size: .82rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .plan { width: 100%; max-height: 220px; background: #0b0f15; border-radius: 8px; }
  .deck { fill: #1c232d; stroke: #3a4452; stroke-width: .05; }
  .mk path { stroke: #9aa7b8; stroke-width: .08; } .mk text { fill: #9aa7b8; font-size: .55px; }
  .mk.on path { stroke: var(--orange); } .mk.on text { fill: var(--orange); }
  .hd { fill: #5d6b7d; } .hd.cur { fill: var(--orange); }
  .fit { fill: none; stroke: var(--green); stroke-width: .07; }
  .marks { width: 100%; border-collapse: collapse; font-size: .82rem; }
  .marks th { text-align: left; color: var(--muted); font-weight: 600; padding: .15rem .2rem; }
  .marks td { padding: .1rem .2rem; } .marks input { width: 100%; min-width: 0; }
  .marks tr.on td:first-child { color: var(--orange); font-weight: 700; }
  .row { display: flex; gap: .4rem; flex-wrap: wrap; }
  .seg { display: flex; gap: .25rem; flex-wrap: wrap; }
  .seg button { padding: .25rem .6rem; font-size: .85rem; }
  .seg button.on, .heads button.on { background: var(--orange); color: #1a1000; border-color: var(--orange); }
  .heads { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .2rem; width: 100%; }
  .heads li { display: flex; gap: .2rem; align-items: center; }
  .heads li > button:first-child { flex: 1; display: flex; justify-content: space-between; gap: .5rem; padding: .2rem .5rem; font-size: .85rem; }
  .heads button.on .faint { color: #1a1000; }
  .steer { display: flex; flex-direction: column; gap: .4rem; border: 1px solid var(--line); border-radius: var(--radius-s); padding: .5rem; width: 100%; box-sizing: border-box; }
  .steer:focus { outline: 2px solid var(--orange); }
  .pads, .pct { display: flex; gap: .3rem; flex-wrap: wrap; align-items: center; }
  .pct label { display: flex; align-items: center; gap: .3rem; color: var(--muted); font-size: .85rem; }
  .pct input { width: 6em; color: var(--text); }
  .ck { display: flex; align-items: center; gap: .4rem; font-size: .88rem; }
  .results { margin: 0; padding-left: 1rem; display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; }
  .good { color: var(--green); } .bad { color: var(--orange); }
  .small { margin: 0; font-size: .8rem; }
  .note { margin: 0; font-size: .85rem; color: var(--orange); }
  .said { margin: 0; font-size: .88rem; color: var(--green); }
  .x { border: 0; background: none; color: var(--muted); padding: 0 .3rem; min-width: 0; }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 0; min-width: 0; }
</style>
