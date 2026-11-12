<script lang="ts">
  // The timeline: a song (a file you drop in, or a demo song) and what happens on it. Drag a cue,
  // an effect or a moment (confetti, flames, a strobe hit...) from the left onto the tracks, or tap
  // it to put it at the playhead; drag what's placed to move it (it snaps to the beat), the end of
  // an effect bar to make it longer. Play runs the show on the song's clock, in Live and 3D too.
  // The show can start before the song (an intro, the walk-on) and go on after it (the cheer, the
  // house lights): those spans sit left and right of the song on the ruler, shaded and named; the
  // song's parts and beat grid only over the song. The crowd's sound has a track of its own.
  import { onDestroy, onMount, setContext, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import Help from './Help.svelte';
  import Modal from './Modal.svelte';
  import StageView from './StageView.svelte';
  import { app, newId } from '../app.svelte';
  import { ui, dialogOpen } from './ui.svelte';
  import { cueNumber } from '../model/cuenum';
  import { isFogTimer } from '../model/library';
  import { isMachineList } from '../content/busking';
  import { cueRiskOf, listRiskOf } from './risk';
  import { AROUND_MAX, CHEER_MAX, addSong, clockOf, moveSong, removeSong, setOptions, snap, songIndex, songName, songsOf, spanOf, type BurstAttr, type CrowdAction, type CrowdItem, type TimelineAction, type TimelineItem, type TimelineSection } from '../model/timeline';
  import { BAR_S, DEMO_SECONDS, playDemo, sectionStarts } from '../timeline/beat';
  import { CATALOG, GENRES, type CatalogSong } from '../timeline/catalog';
  import { SongError, creditOf, downloadSong } from '../timeline/download';
  import { ShowChanged } from '../timeline/player.svelte';
  import { SURE, type SongAnalysis } from '../timeline/analyze';
  import { analyzeAudio } from '../timeline/songAnalysis';

  const P = app.timeline;
  // App.svelte keeps this view while another is shown. Hidden, it rests: the stage isn't drawn
  // (the 3D one hands its world on), the tracks don't follow the playhead (hidden they measure 0
  // wide: the last width is kept, so the scale and the scroll are as they were when it's back),
  // the keys are the shown view's.
  const shown = $derived(app.view === 'timeline');
  setContext('view-shown', () => app.view === 'timeline');
  // where the playhead is drawn: hidden, it holds still (no update every frame for nobody)
  const at = $derived.by(() => (shown ? P.position : untrack(() => P.position)));
  // A first visit draws the frame (the song, the transport, the ruler) at once, the cues to place
  // and what's on the tracks a moment later, in a task of their own once the frame is on screen
  let built = $state(false);
  $effect(() => { const id = requestAnimationFrame(() => setTimeout(() => (built = true))); return () => cancelAnimationFrame(id); });
  onMount(() => { void P.prepare(); });
  $effect(() => { void app.show.timeline?.audio?.store; void app.show.timeline?.demo; void P.prepare(); });

  const tl = $derived(app.show.timeline);
  const items = $derived(tl?.items ?? []);
  const crowd = $derived(tl?.crowd ?? []);
  // the show's span on the song's clock: from the start of the time before the song to the end of
  // the time after it (the song itself is 0 to its length)
  const span = $derived(spanOf(tl ? { duration: P.duration || tl.duration, lead: tl.lead, tail: tl.tail } : { duration: 240 }));
  // (not the fog timers, nor the machines' own shot lists: those are buttons, not looks)
  const lists = $derived(app.show.cueLists.filter((l) => !isFogTimer(l) && !isMachineList(l, app.isMachineFx)));
  // one lane per list that's on the timeline or could be, then effects, then moments
  const lanes = $derived([...lists.map((l) => ({ id: `list:${l.id}`, name: l.name, color: l.color ?? '#45d85c' })),
    { id: 'fx', name: 'Effects', color: '#ffaa1c' }, { id: 'crowd', name: 'Crowd', color: '#7fc8ff' }, { id: 'special', name: 'Moments', color: '#f33abc' }]);
  // the crowd's moments: how it sounds from there on (got to over the bar's length), or a cheer
  const CROWD: { label: string; a: CrowdAction; len: number; tip: string }[] = [
    { label: 'Chatter', a: { do: 'crowd', mood: 'chatter', level: 0.5 }, len: 2, tip: 'People talking while they wait' },
    { label: 'Cheering', a: { do: 'crowd', mood: 'cheer', level: 0.5 }, len: 2, tip: 'The crowd cheers from here on' },
    { label: 'Roar', a: { do: 'crowd', mood: 'cheer', level: 1 }, len: 1, tip: 'As loud as they get' },
    { label: 'Quiet', a: { do: 'crowd', mood: 'cheer', level: 0 }, len: 3, tip: 'The crowd goes quiet' },
    { label: 'Cheer!', a: { do: 'cheer', level: 1 }, len: 4, tip: 'A cheer that swells up and dies away' },
  ];
  const crowdLabel = (a: CrowdAction) => {
    const pc = `${Math.round(a.level * 100)} %`;
    if (a.do === 'cheer') return `Cheer! ${pc}`;
    if (a.level === 0) return 'Crowd quiet';
    return `${a.mood === 'chatter' ? 'Chatter' : a.level >= 0.95 ? 'Roar' : 'Cheering'} ${pc}`;
  };
  const BURSTS: { attr: BurstAttr; label: string; s: number }[] = [
    { attr: 'confetti', label: 'Confetti', s: 1 }, { attr: 'flame', label: 'Flames', s: 1.5 }, { attr: 'sparks', label: 'Sparks', s: 4 },
    { attr: 'co2', label: 'CO2 jet', s: 2 }, { attr: 'bubbles', label: 'Bubbles', s: 8 }, { attr: 'fog', label: 'Fog', s: 5 },
    { attr: 'strobe', label: 'Strobe hit', s: 2 }, { attr: 'blinder', label: 'Blinder hit', s: 1 }];

  // ---- scale and scrolling
  let tracks = $state<HTMLDivElement>();
  let width = $state(800);
  let pps = $state(0);                       // pixels a second (0: fit the song)
  const fit = $derived(Math.max(2, (width - 8) / Math.max(10, span.to - span.from)));
  const scale = $derived(pps || fit);
  // (the ruler starts where the show does: before the song's 0 when there's time before it)
  const x = (t: number) => (t - span.from) * scale;
  const inSpan = (t: number) => Math.max(span.from, Math.min(span.to, t));
  const tAt = (clientX: number) => { const r = tracks!.getBoundingClientRect(); return inSpan((clientX - r.left + tracks!.scrollLeft) / scale + span.from); };
  let snapTo = $state<'bar' | 'beat' | 'off'>('beat');
  const sn = (t: number, free = false) => {
    const song = P.duration || tl?.duration || 0;
    if (free || snapTo === 'off') return inSpan(Math.round(t * 20) / 20);
    // the song's start and end close by (8 px) win, then a part of the song: cues land right on
    // the chorus, the drop...
    for (const edge of [0, song]) if ((span.from < 0 || span.to > song) && Math.abs(edge - t) * scale < 8) return edge;
    // (before and after the song there's no beat: half seconds)
    if (t < 0 || t > song) return inSpan(Math.round(t * 2) / 2);
    const near = sections.find((s) => Math.abs(s.at - t) * scale < 8);
    return near ? near.at : Math.min(song, snap(t, tl?.bpm ?? app.show.settings.bpm, snapTo === 'bar' ? 4 : 1, tl?.offset ?? 0));
  };
  // the grid: bars (and beats when there's room)
  const grid = $derived.by(() => {
    // (a tempo that isn't a sane number would loop for ever here: 120)
    const raw = tl?.bpm ?? app.show.settings.bpm, bpm = Number.isFinite(raw) && raw >= 20 && raw <= 300 ? raw : 120;
    const beat = 60 / bpm, d = P.duration || tl?.duration || 240, out: { t: number; bar: boolean; n: number }[] = [];
    const every = scale * beat < 6 ? (scale * beat * 4 < 14 ? 4 * Math.ceil(14 / (scale * beat * 4)) : 4) : 1;
    for (let i = 0, t = tl?.offset ?? 0; t <= d; i += every, t = (tl?.offset ?? 0) + i * beat) out.push({ t, bar: i % 4 === 0, n: i / 4 + 1 });
    return out;
  });
  // the song's parts: the demo beat's own, the ones a demo song came with, the ones found in a song
  // file of your own, or set by hand
  const sections = $derived.by((): { name: string; at: number; end: number; energy?: number }[] => {
    if (!tl) return [];
    if (tl.demo && !tl.audio && !tl.sections?.length) return sectionStarts();
    const s = tl.sections ?? [], d = P.duration || tl.duration;
    return s.map((x, i) => ({ name: x.name, at: x.at, end: Math.max(x.at, s[i + 1]?.at ?? d), energy: x.energy }));
  });
  function zoom(f: number, at?: number) {
    const anchor = at ?? (tracks ? tracks.scrollLeft + tracks.clientWidth / 2 : 0), t = anchor / scale;
    pps = Math.max(2, Math.min(240, scale * f));
    queueMicrotask(() => { if (tracks) tracks.scrollLeft = t * scale - (anchor - tracks.scrollLeft); });
  }
  // the time before and after the song (seconds): what's placed there can't be cut off by it.
  // Hands back what it is now (the field shows that).
  function setAround(k: 'lead' | 'tail', v: number): number {
    const T = app.timeline.ensure(), song = P.duration || T.duration;
    let s = Math.round(Math.max(0, Math.min(AROUND_MAX, Number.isFinite(v) ? v : 0)));
    const at = [...T.items.map((i) => i.at + (k === 'tail' ? i.len ?? 0 : 0)), ...(T.crowd ?? []).map((i) => i.at + (k === 'tail' ? i.len ?? 0 : 0))];
    const need = k === 'lead' ? Math.ceil(Math.max(0, ...at.map((a) => -a))) : Math.ceil(Math.max(0, ...at.map((a) => a - song)));
    if (s < need) { ui.toast(`Something is placed ${k === 'lead' ? `${need} s before the song` : `${need} s after it`}: move it or remove it first`, 4500); s = need; }
    if (s === (T[k] ?? 0)) return s;
    app.checkpoint();
    if (s) T[k] = s; else delete T[k];
    if (k === 'lead' && !P.playing && P.position < -s) P.seek(-s);
    if (k === 'tail' && !P.playing && P.position > song + s) P.seek(song + s);
    app.markDirty(0);
    return s;
  }
  function wheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - tracks!.getBoundingClientRect().left + tracks!.scrollLeft);
  }
  // follow the playhead while it plays (from what's known: reading the scroll position each frame
  // would make the browser lay the page out again every frame)
  let scrolled = 0;
  $effect(() => {
    if (!shown) return;
    const px = x(at);
    if (!P.playing || !tracks) return;
    if (px > scrolled + width - 60 || px < scrolled) { tracks.scrollLeft = scrolled = Math.max(0, px - 80); }
  });
  // the time before and after the song, on the ruler and behind the tracks
  const around = $derived.by(() => {
    const song = P.duration || tl?.duration || 0, out: { cls: string; name: string; from: number; to: number }[] = [];
    if (span.from < 0) out.push({ cls: 'lead', name: 'Before the song', from: span.from, to: 0 });
    if (span.to > song) out.push({ cls: 'tail', name: 'After the song', from: song, to: span.to });
    return out;
  });

  // ---- what's on it
  const labelOf = (i: Placed) => {
    if (isCrowd(i)) return crowdLabel(i.do);
    const a = i.do;
    if (a.do === 'goto') { const l = app.show.cueLists.find((x) => x.id === a.list), k = l?.cues.findIndex((c) => c.id === a.cue) ?? -1; return l && k >= 0 ? `${cueNumber(l, k)}. ${l.cues[k].name}` : '(gone)'; }
    if (a.do === 'effect') return app.show.effects.find((e) => e.id === a.effect)?.name ?? '(gone)';
    if (a.do === 'burst') return BURSTS.find((b) => b.attr === a.attr)?.label ?? a.attr;
    if (a.do === 'blackout') return a.on ? 'Blackout' : 'Blackout off';
    if (a.do === 'off') return 'Everything off';
    if (a.do === 'release') return 'Fade out';
    return a.do;
  };
  let sel = $state<string | null>(null);
  function place(a: TimelineAction, at: number, lane: string, len?: number) {
    const t = app.timeline.ensure();
    app.checkpoint();
    const sp = spanOf(t), at2 = Math.max(sp.from, Math.min(sp.to, at));
    // (an effect bar ends by the end of the show: it would never be switched off after it)
    const it: TimelineItem = { id: newId('t'), at: at2, lane, do: a, ...(len ? { len: Math.max(0.5, Math.min(len, sp.to - at2)) } : {}) };
    t.items = [...t.items, it];
    if (!app.show.timeline!.audio && !app.show.timeline!.demo && at2 <= t.duration) t.duration = Math.max(t.duration, at2 + 16);
    sel = it.id;
    app.markDirty(0);
  }
  // a crowd moment (its own track: the crowd's sound, model/timeline.ts)
  function placeCrowd(a: CrowdAction, at: number, len: number) {
    const t = app.timeline.ensure();
    app.checkpoint();
    const sp = spanOf(t), at2 = Math.max(sp.from, Math.min(sp.to, at));
    const it: CrowdItem = { id: newId('c'), at: at2, do: { ...a }, len: Math.max(a.do === 'cheer' ? 0.5 : 0, Math.min(len, a.do === 'cheer' ? CHEER_MAX : 60)) };
    t.crowd = [...(t.crowd ?? []), it].sort((x, y) => x.at - y.at);
    sel = it.id;
    app.markDirty(0);
  }
  // what a palette chip stands for
  type Chip = { kind: 'cue'; list: string; cue: string } | { kind: 'fx'; effect: string } | { kind: 'burst'; attr: BurstAttr; s: number } | { kind: 'act'; a: TimelineAction } | { kind: 'crowd'; a: CrowdAction; len: number };
  function chipAt(c: Chip, at: number) {
    const bar = (60 / (tl?.bpm ?? app.show.settings.bpm)) * 4;
    if (c.kind === 'cue') place({ do: 'goto', list: c.list, cue: c.cue }, at, `list:${c.list}`);
    else if (c.kind === 'fx') place({ do: 'effect', effect: c.effect, on: true }, at, 'fx', bar * 8);
    else if (c.kind === 'burst') place({ do: 'burst', attr: c.attr, seconds: c.s }, at, 'special');
    else if (c.kind === 'crowd') placeCrowd(c.a, at, c.len);
    else place(c.a, at, 'special');
  }
  // anything on the tracks (a crowd moment has no lane of its own in the file: it's the crowd's)
  type Placed = TimelineItem | (CrowdItem & { lane?: undefined });
  const placed = (id: string): Placed | undefined => tl?.items.find((i) => i.id === id) ?? tl?.crowd?.find((i) => i.id === id);
  const isCrowd = (it: Placed): it is CrowdItem => it.do.do === 'crowd' || it.do.do === 'cheer';
  const DT = 'application/x-luxdmx-timeline';
  function dragChip(e: DragEvent, c: Chip) { e.dataTransfer?.setData(DT, JSON.stringify(c)); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }
  let dropAt = $state<number | null>(null);
  function over(e: DragEvent) { if (e.dataTransfer?.types.includes(DT) || e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dropAt = sn(tAt(e.clientX), e.altKey); } }
  async function drop(e: DragEvent) {
    e.preventDefault();
    const at = sn(tAt(e.clientX), e.altKey); dropAt = null;
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('audio/')) { await loadSong(f); return; }
    const raw = e.dataTransfer?.getData(DT);
    if (raw) chipAt(JSON.parse(raw) as Chip, at);
  }

  // dragging what's placed (and the end of an effect bar, a crowd change or a cheer)
  let drag: { id: string; dx: number; end: boolean; moved: boolean } | null = null;
  function itemDown(e: PointerEvent, it: Placed, end = false) {
    if (e.button !== 0) return;
    e.stopPropagation();
    sel = it.id;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: it.id, dx: tAt(e.clientX) - (end ? it.at + (it.len ?? 0) : it.at), end, moved: false };
  }
  function itemMove(e: PointerEvent) {
    if (!drag || !tl) return;
    const it = placed(drag.id);
    if (!it) return;
    if (!drag.moved) { app.checkpoint(); drag.moved = true; }
    const t = sn(tAt(e.clientX) - drag.dx, e.altKey), crowdy = isCrowd(it), max = crowdy ? (it.do.do === 'cheer' ? CHEER_MAX : 60) : Infinity, least = crowdy && it.do.do !== 'cheer' ? 0 : 0.5;
    if (drag.end) it.len = Math.max(least, Math.min(max, span.to - it.at, t - it.at));
    else { it.at = inSpan(t); if (it.len !== undefined) it.len = Math.max(least, Math.min(it.len, span.to - it.at)); }
  }
  function itemUp() {
    // (the crowd's track stays in time order)
    if (drag?.moved) { if (tl?.crowd?.some((x, i, a) => i && x.at < a[i - 1].at)) tl.crowd = [...tl.crowd].sort((a, b) => a.at - b.at); app.markDirty(0); }
    drag = null;
  }
  function remove(id: string) {
    if (!tl) return;
    app.checkpoint();
    tl.items = tl.items.filter((i) => i.id !== id);
    if (tl.crowd?.some((i) => i.id === id)) { const k = tl.crowd.filter((i) => i.id !== id); if (k.length) tl.crowd = k; else delete tl.crowd; }
    if (sel === id) sel = null;
    app.markDirty(0);
  }
  // a crowd moment louder or softer (a quarter at a time)
  function crowdLevel(it: CrowdItem, d: number) {
    app.checkpoint();
    it.do.level = Math.round(Math.max(0, Math.min(1, it.do.level + d)) * 100) / 100;
    app.markDirty(0);
  }
  function itemMenu(e: MouseEvent, it: Placed) {
    e.preventDefault(); sel = it.id;
    ui.openMenu(e, [
      { label: `Go to ${clockOf(it.at)}`, icon: 'play', run: () => jump(it.at) },
      ...(isCrowd(it) ? [{ stepper: { value: () => `${Math.round(it.do.level * 100)} %`, minus: () => crowdLevel(it, -0.25), plus: () => crowdLevel(it, 0.25),
        minusOff: () => it.do.level <= 0, plusOff: () => it.do.level >= 1 }, label: 'How loud' }] : []),
      { label: 'Duplicate at the playhead', icon: 'duplicate', run: () => (isCrowd(it) ? placeCrowd(structuredClone($state.snapshot(it.do)) as CrowdAction, sn(P.position), it.len ?? 0)
        : place(structuredClone($state.snapshot(it.do)) as TimelineAction, sn(P.position), it.lane, it.len)) },
      { sep: true },
      { label: 'Remove', icon: 'trash', danger: true, keys: 'Del', run: () => remove(it.id) },
    ]);
  }
  // ---- going through the song is a scrub: the stage shows the looks at that point (cues, effects
  // on or off, blackout) and NOTHING fires: no confetti, flames, sparks, CO2, fog, strobe or blinder
  // hits. Playing before, it plays on from where it's let go (what's placed right there doesn't fire).
  let scrubT = 0;
  function scrubStart() { P.scrubStart(); }
  function scrubTo(t: number) { scrubT = inSpan(t); P.scrub(scrubT); }
  function scrubEnd() { P.scrubEnd(scrubT); }
  // a jump (a key, a click on a part of the song, Go to): a scrub that's over at once
  function jump(t: number) { scrubStart(); scrubTo(t); scrubEnd(); }
  // dragging the playhead (anywhere along it) or on the ruler
  let scrubbing = $state(false);
  let toldScrub = false;
  function scrubDown(e: PointerEvent, ruler = false) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    scrubbing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // on stage, the real lights follow the drag (never a machine): said the first time
    if (app.output === 'live' && app.bridges.length && !toldScrub) {
      toldScrub = true;
      ui.toast('On stage: the real lights and heads follow the playhead as you drag (confetti, flames, sparks, CO2 and fog bursts never fire). Blind (top right) lets you look around without them.', 9000);
    }
    scrubStart();
    scrubTo(ruler ? sn(tAt(e.clientX), true) : tAt(e.clientX));
  }
  function scrubMove(e: PointerEvent) { if (scrubbing) scrubTo(tAt(e.clientX)); }
  function scrubUp() { if (!scrubbing) return; scrubbing = false; scrubEnd(); }
  // moments that fire a machine (a hazard on the tracks), and confetti (once: it's gone after);
  // a cue on the tracks that fires them is marked the same (model/safety.ts)
  const HAZARD = new Set(['flame', 'co2', 'sparks']);
  // (a cue's or a list's mark worked out once per change of the show, ui/risk.ts: worked out
  // afresh for every item on every draw, the demo's timeline took a second and a half to open)
  const markOf = (i: Placed) => {
    if (isCrowd(i)) return '';
    const a = i.do;
    if (a.do === 'burst') return HAZARD.has(a.attr) ? 'hazard' : a.attr === 'confetti' ? 'once' : '';
    if (a.do !== 'goto' && a.do !== 'start' && a.do !== 'go') return '';
    const l = app.show.cueLists.find((x) => x.id === a.list), c = a.do === 'goto' ? l?.cues.find((x) => x.id === a.cue) : undefined;
    const r = c ? cueRiskOf(app.show, c, app.showRev) : l && a.do !== 'goto' ? listRiskOf(app.show, l, app.showRev) : 'light';
    return r === 'hazard' || r === 'once' ? r : '';
  };

  // ---- the song
  let fileIn = $state<HTMLInputElement>();
  // A file of your own: the last song's tempo, first downbeat and parts aren't this one's, so they go
  // at once, and what's found in the sound comes on (its own undo step) a moment later. The same file
  // loaded again for a song this browser didn't have keeps what the song has.
  let finding = $state('');                 // the song whose tempo is being found
  async function loadSong(f: File) {
    const again = !!P.missing && tl?.audio?.name === f.name, forShow = app.showId;
    let buf: AudioBuffer;
    try { buf = await P.loadFile(f, app.showId, !again); } catch { ui.toast("That file doesn't play here (an mp3, wav, ogg or m4a does)", 4000); return; }
    pps = 0;
    const t = app.show.timeline, store = t?.audio?.store;
    if (!t || again) { ui.toast(`"${f.name}" is the song now (${clockOf(P.duration, false)})`); return; }
    finding = f.name;
    let a: SongAnalysis | null = null;
    try { a = await analyzeAudio(buf); } catch { /* said below */ }
    if (finding === f.name) finding = '';
    // (still this song: not another file, another show or an undo meanwhile)
    const now = app.show.timeline;
    if (app.showId !== forShow || !now || now.audio?.store !== store) return;
    if (!a) { ui.toast(`"${f.name}" is the song now. Its tempo couldn't be worked out here: type it (BPM) or tap it.`, 7000); return; }
    app.checkpoint();
    // (a tempo or parts set by hand meanwhile stay)
    if (a.bpm && now.bpm === undefined) { now.bpm = a.bpm; now.offset = a.offset; }
    if (a.sections.length && !now.sections?.length) now.sections = a.sections.map((x) => ({ ...x }));
    app.markDirty(0);
    ui.toast(foundText(a), a.doubt ? 9000 : 6000);
  }
  // what was found, in a few words
  function foundText(a: SongAnalysis) {
    const bpm = Math.round(a.bpm * 10) / 10, first = `first beat at ${clockOf(a.offset)}`;
    if (!a.bpm) return 'No steady beat found in this song: type its tempo (BPM) or tap it, and add parts with P.';
    if (a.confidence < SURE) {
      const why = a.doubt === 'double' ? `it may be twice as fast, ${Math.round(bpm * 2)} BPM` : a.doubt === 'tempo' ? 'it could be another tempo' : "the beat isn't clear or steady";
      return `About ${bpm} BPM, ${first}. Not sure (${why}), so no parts: check the tempo (BPM or Tap) and add parts with P.`;
    }
    const n = a.sections.length;
    return `${bpm} BPM, ${first}, ${n ? `${n} part${n === 1 ? '' : 's'} found: check them on the ruler` : 'no parts found: P adds one at the playhead'}.`;
  }

  // ---- the song's parts by hand: P (or Add a part) starts one at the bar line nearest the playhead,
  // named after the one before it ("Chorus 2"); on the ruler a double-click renames one, a right-click
  // removes it
  const baseName = (n: string) => n.replace(/\s+\d+$/, '');
  // the parts as the show keeps them (the demo beat's own become the song's to change)
  function ownParts(): TimelineSection[] {
    const t = app.timeline.ensure();
    if (!t.sections?.length && t.demo && !t.audio) t.sections = sectionStarts().map((x) => ({ name: x.name, at: x.at, ...(x.energy !== undefined ? { energy: x.energy } : {}) }));
    return (t.sections ??= []);
  }
  function nextName(list: TimelineSection[], base: string) {
    let n = 0;
    for (const s of list) if (baseName(s.name) === base) n = Math.max(n, Number(/\s(\d+)$/.exec(s.name)?.[1] ?? 1));
    return n ? `${base} ${n + 1}` : base;
  }
  function addPart(t = P.position) {
    const T = app.timeline.ensure(), bpm = T.bpm ?? app.show.settings.bpm, bar = (60 / bpm) * 4;
    let at = Math.round(snap(t, bpm, 4, T.offset ?? 0) * 100) / 100;
    if (at >= T.duration - 0.05) at = Math.max(0, Math.round((at - bar) * 100) / 100);
    const cur = app.show.timeline?.sections?.length ? app.show.timeline.sections : sections.map((x) => ({ name: x.name, at: x.at }));
    const same = cur.find((x) => Math.abs(x.at - at) < 0.05);
    if (same) { ui.toast(`"${same.name}" already starts there (${clockOf(at)})`, 3500); return; }
    app.checkpoint();
    const list = ownParts(), before = [...list].filter((x) => x.at < at).pop();
    const add: TimelineSection[] = [];
    if (before) add.push({ name: nextName(list, baseName(before.name)), at, ...(before.energy !== undefined ? { energy: before.energy } : {}) });
    else if (at <= (T.offset ?? 0) + bar + 0.05) add.push({ name: nextName(list, 'Intro'), at });
    // (nothing before it: the start of the song gets an intro, so every moment is in a part)
    else add.push({ name: nextName(list, 'Intro'), at: 0 }, { name: nextName(list, 'Verse'), at });
    T.sections = [...list, ...add].sort((a, b) => a.at - b.at);
    app.markDirty(0);
    const made = add[add.length - 1];
    ui.toast(`"${made.name}" starts at ${clockOf(at)}. Double-click it on the ruler to rename it, right-click to remove it.`, 4500);
  }
  async function renamePart(at: number) {
    const s = sections.find((x) => x.at === at);
    if (!s) return;
    const n = await ui.ask('Rename the part', s.name);
    if (n === null || !n.trim() || n.trim() === s.name) return;
    app.checkpoint();
    const p = ownParts().find((x) => x.at === at);
    if (p) p.name = n.trim().slice(0, 40);
    app.markDirty(0);
  }
  function removePart(at: number) {
    const s = sections.find((x) => x.at === at);
    if (!s) return;
    app.checkpoint();
    const T = app.timeline.ensure();
    T.sections = ownParts().filter((x) => x.at !== at);
    app.markDirty(0);
    app.toastUndo(`"${s.name}" is gone (the part before it runs on)`);
  }
  function partMenu(e: MouseEvent, s: { name: string; at: number }) {
    e.preventDefault(); e.stopPropagation();
    ui.openMenu(e, [
      { label: `Go to ${s.name}`, icon: 'play', run: () => jump(s.at) },
      { label: 'Rename…', icon: 'edit', run: () => renamePart(s.at) },
      { sep: true },
      { label: 'Remove this part', icon: 'trash', danger: true, run: () => removePart(s.at) },
    ]);
  }
  function rulerMenu(e: MouseEvent) {
    e.preventDefault();
    const t = tAt(e.clientX);
    ui.openMenu(e, [{ label: 'Add a part here', icon: 'plus', keys: 'P', run: () => addPart(t) }]);
  }

  // ---- demo songs: the demo beat (made here) and real songs, downloaded when picked
  let picking = $state(false);
  const byGenre = (() => {
    const m = new Map<string, CatalogSong[]>();
    for (const s of CATALOG) { const g = GENRES[s.genre] ?? s.genre; m.set(g, [...(m.get(g) ?? []), s]); }
    return [...m];
  })();
  const missingSong = $derived(P.missing && tl?.audio?.catalog ? CATALOG.find((s) => s.id === tl.audio!.catalog) : undefined);
  // the credit the song's licence asks for, under the waveform while it's the song
  const credit = $derived.by(() => {
    const a = tl?.audio;
    if (!a?.catalog && !a?.credit) return null;
    const s = CATALOG.find((x) => x.id === a.catalog);
    return { text: a.credit ?? (s ? creditOf(s) : ''), s };
  });

  // a short listen: the demo beat from just before its first drop, a song from its chorus (or a third in)
  let listening = $state('');
  let pv: { ctx?: AudioContext; stop?: () => void; timer?: ReturnType<typeof setTimeout> } = {};
  function listen(s: CatalogSong | null) {
    const id = s?.id ?? 'demo', again = listening === id;
    hush();
    if (again) return;
    if (P.playing) P.pause();
    listening = id;
    pv.timer = setTimeout(hush, 15000);
    if (!s) {
      try { pv.ctx ??= new AudioContext(); } catch { hush(); ui.toast("This browser can't play sound here", 3500); return; }
      const ctx = pv.ctx, g = ctx.createGain();
      g.gain.value = P.volume; g.connect(ctx.destination); void ctx.resume();
      const stop = playDemo(ctx, g, sectionStarts().find((x) => x.name === 'Drop')!.at - 2 * BAR_S);
      pv.stop = () => { stop(); setTimeout(() => g.disconnect(), 500); };
      return;
    }
    const from = s.sections.find((x) => /chorus|drop|hook/i.test(x.name))?.at ?? s.duration / 3;
    const a = new Audio(), srcs = [s.url, s.mirror].filter((u): u is string => !!u);
    let n = 0;
    a.preload = 'auto'; a.volume = P.volume;
    a.onerror = () => { if (listening !== s.id) return; if (++n < srcs.length) a.src = srcs[n]; else { hush(); ui.toast(`"${s.title}" can't be played right now (offline, or its site is blocked here)`, 4500); } };
    a.onloadedmetadata = () => { if (Number.isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(from, a.duration - 16)); void a.play().catch(() => {}); };
    a.src = srcs[0];
    pv.stop = () => { a.onerror = null; a.pause(); a.removeAttribute('src'); };
  }
  function hush() { clearTimeout(pv.timer); pv.stop?.(); pv.stop = undefined; listening = ''; }
  onDestroy(() => { hush(); void pv.ctx?.close().catch(() => {}); });

  // picking a song: it downloads (with progress), stays in this browser like a file you load, and
  // brings its tempo, first downbeat, parts and credit onto the timeline
  let dl = $state<{ id: string; title: string; got: number; total: number; ctl: AbortController } | null>(null);
  const pct = (d: { got: number; total: number }) => (d.total ? `${Math.min(99, Math.round((d.got / d.total) * 100))} %` : `${(d.got / 1e6).toFixed(1)} MB`);
  async function take(s: CatalogSong) {
    hush();
    dl?.ctl.abort();
    const ctl = new AbortController();
    dl = { id: s.id, title: s.title, got: 0, total: 0, ctl };
    const forShow = app.showId;                        // (the show it's for, whatever is open when it's done)
    let file: File;
    try { file = await downloadSong(s, (got, total) => { if (dl?.ctl === ctl) { dl.got = got; dl.total = total; } }, ctl.signal); }
    catch (e) {
      if (dl?.ctl !== ctl) return;
      dl = null;
      if (!ctl.signal.aborted) ui.toast(e instanceof SongError ? e.message : `"${s.title}" can't be downloaded right now. Try again later.`, 6000);
      return;
    }
    if (dl?.ctl !== ctl) return;                       // cancelled, or another one picked meanwhile
    try { await P.loadFile(file, forShow); }
    catch (e) {
      dl = null;
      ui.toast(e instanceof ShowChanged ? `"${s.title}" came down after another show was opened, so it isn't on this one. Pick it again in the show it was for.`
        : `"${s.title}" came down, but it doesn't play in this browser`, 7000);
      return;
    }
    dl = null;
    const t = app.timeline.ensure();
    t.bpm = s.bpm; t.offset = s.offset;
    t.sections = s.sections.map((x) => ({ name: x.name, at: x.at, ...(Number.isFinite(x.energy) ? { energy: x.energy } : {}) }));
    if (t.audio) { t.audio.catalog = s.id; t.audio.credit = creditOf(s); }
    app.markDirty(0);
    picking = false; pps = 0;
    ui.toast(`"${s.title}" by ${s.artist} is the song now (${s.bpm} BPM, ${clockOf(P.duration, false)}). Its parts are on the ruler.`, 4000);
  }
  function cancel() { dl?.ctl.abort(); dl = null; }
  function takeDemo() {
    hush(); cancel();
    P.useDemo();
    if (app.show.timeline?.sections) { delete app.show.timeline.sections; app.markDirty(0); }
    picking = false; pps = 0;
    ui.toast('The demo beat: ten minutes, 126 BPM, with builds and drops');
  }
  function closePicker() { hush(); picking = false; }
  // another view shown: a short listen stops, the song picker closes (as when this view went away)
  $effect(() => { if (!shown) untrack(closePicker); });

  // ---- the set list: the songs of the gig in one show, in order. The one picked is on the tracks
  // (and up next in Live); the patch, the cues, the effects and the pages are the whole set's.
  const songs = $derived(songsOf(app.show));
  const cur = $derived(songIndex(app.show));
  // picking one: stopped at its start, its first look on the stage (never dark, see app.pickSong)
  function pickSong(i: number) { if (i === cur) return; hush(); cancel(); app.pickSong(i); pps = 0; sel = null; }
  function newSong() {
    hush(); cancel();
    app.checkpoint();
    addSong(app.show, { duration: 240, bpm: app.show.settings.bpm, items: [] });
    app.pickSong(songsOf(app.show).length - 1);
    app.markDirty(0); pps = 0; sel = null;
    ui.toast('A new song at the end of the set: load its file or pick a demo song, then put cues on it', 4500);
  }
  function moveTo(from: number, to: number) {
    if (to < 0 || to >= songs.length) return;
    app.checkpoint(); moveSong(app.show, from, to); app.markDirty(0);
    queueMicrotask(() => document.querySelectorAll<HTMLElement>('.tlv .setlist .pick')[to]?.focus());
  }
  async function renameSong(i: number) {
    const n = await ui.ask('Rename the song', songName(songs[i], i));
    if (n === null) return;
    const t = songsOf(app.show)[i];
    if (!t) return;
    app.checkpoint();
    if (n.trim()) t.name = n.trim().slice(0, 80); else delete t.name;
    app.markDirty(0);
  }
  async function dropSong(i: number) {
    const t = songs[i], name = songName(t, i);
    if (!t || songs.length < 2) return;
    if (t.items.length && !(await ui.confirm(`Remove "${name}" from the set?`, `Its ${t.items.length === 1 ? 'one cue or moment goes' : `${t.items.length} cues and moments go`} with it. Undo brings it back.`, 'Remove'))) return;
    const up = i === songIndex(app.show);
    app.checkpoint();
    removeSong(app.show, i);
    app.markDirty(0);
    if (up) { app.pickSong(songIndex(app.show)); pps = 0; sel = null; }
    app.toastUndo(`"${name}" is out of the set`);
  }
  function songMenu(e: MouseEvent, i: number) {
    ui.openMenu(e, [
      { label: 'Rename…', icon: 'edit', run: () => renameSong(i) },
      { label: 'Earlier in the set', icon: 'up', keys: 'Alt+↑', disabled: i === 0, run: () => moveTo(i, i - 1) },
      { label: 'Later in the set', icon: 'down', keys: 'Alt+↓', disabled: i >= songs.length - 1, run: () => moveTo(i, i + 1) },
      { sep: true },
      { label: 'Remove from the set', icon: 'trash', danger: true, disabled: songs.length < 2, run: () => dropSong(i) },
    ]);
  }
  // the set's own settings: a count-in, the look between songs
  const between = $derived(app.show.setlist?.between ? JSON.stringify([app.show.setlist.between.list, app.show.setlist.between.cue]) : '');
  function setBetween(v: string) {
    app.checkpoint();
    const [list, cue] = v ? (JSON.parse(v) as [string, string]) : ['', ''];
    setOptions(app.show, { between: v ? { list, cue } : null });
    app.markDirty(0);
  }
  function setCountIn(v: number) { app.checkpoint(); setOptions(app.show, { countIn: v || null }); app.markDirty(0); }

  // ---- keys: Space plays and pauses, Home to the start, Del removes, arrows step a bar, P a part
  function keys(e: KeyboardEvent) {
    if (app.view !== 'timeline' || dialogOpen()) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const bar = (60 / (tl?.bpm ?? app.show.settings.bpm)) * 4;
    if (e.code === 'Space' && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); P.toggle(); }
    else if (e.key === 'Home') { e.preventDefault(); jump(P.start); }
    else if (e.key === 'End') { e.preventDefault(); jump(P.end); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(sel); }
    else if (e.key === 'ArrowRight' && !e.altKey) { e.preventDefault(); jump(P.position + bar); }
    else if (e.key === 'ArrowLeft' && !e.altKey) { e.preventDefault(); jump(P.position - bar); }
    else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) { e.preventDefault(); addPart(); }
  }
  const peaksPath = $derived.by(() => {
    const p = P.peaks, d = P.duration || 1, w = d * scale;
    if (!p.length) return '';
    let s = 'M0 22';
    p.forEach((v, i) => { s += `L${((i + 0.5) / p.length * w).toFixed(1)} ${(22 - v * 20).toFixed(1)}`; });
    for (let i = p.length - 1; i >= 0; i--) s += `L${((i + 0.5) / p.length * w).toFixed(1)} ${(22 + p[i] * 20).toFixed(1)}`;
    return s + 'Z';
  });
</script>

<svelte:window onkeydown={keys} />

<div class="tlv">
  <aside class="pal" aria-label="What can go on the timeline">
    <div class="row head"><h2>Timeline</h2>
      <Help label="About the timeline">
        <p>A song and what happens on it: drag a cue, an effect or a moment onto the tracks (or tap it: it goes where the playhead is). Drag what's placed to move it; it snaps to the beat (Alt: free). An effect bar's end makes it longer.</p>
        <p>Play runs the show on the song: cues, effects and moments happen when the song gets there, in Live and on the 3D stage too. A click on the ruler jumps there, and the stage is as it would be at that point.</p>
        <p>Demo songs: real songs with vocals, free to use under their Creative Commons licences, downloaded when you pick one; or the demo beat made in the app. Their parts (intro, verse, chorus, drop...) show on the ruler: a click on one goes there, and cues snap to them.</p>
        <p>A song file of your own: its tempo, first downbeat and parts are found from the sound (check them: BPM, and the parts on the ruler). P or Add a part starts a part at the bar line nearest the playhead; on the ruler a double-click renames a part, a right-click removes it.</p>
        <p>Before and after the song: give the show time before the song starts (an intro, the band walking on) and after it ends (the cheer, the house lights up). Things go there like anywhere else; Play from the start begins at the very start, and the song comes in at its own 0:00.</p>
        <p>The crowd: Chatter, Cheering, Roar and Quiet change how the crowd sounds from there on, over the length of the bar; a Cheer! swells up and dies away. Right-click one for how loud. The crowd's own volume sits next to the song's.</p>
        <p>Space plays and pauses, Home goes back to the very start, the arrows a bar, P adds a part, Del removes what's selected, Ctrl+wheel zooms. A song stays in this browser; the show file only names it.</p>
        <p>A gig: put every song in the set list, in order, each with its own file and cues (the lights, cues and effects are the whole set's). On Live, Next song gets the next one ready without the lights going dark, and Play from the start comes in on the first downbeat.</p>
      </Help>
    </div>
    <section class="set" aria-label="Set list">
      <h3>Set list</h3>
      {#if songs.length}
        <ol class="setlist">
          {#each songs as s, i (s)}
            <li class:cur={i === cur}>
              <button class="pick" aria-current={i === cur ? 'true' : undefined} onclick={() => pickSong(i)} oncontextmenu={(e) => songMenu(e, i)} ondblclick={() => renameSong(i)}
                onkeydown={(e) => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveTo(i, i + (e.key === 'ArrowUp' ? -1 : 1)); } }}
                title={i === cur ? 'On the tracks now. Double-click to rename, right-click for more' : 'Show this one (it is up next in Live). Double-click to rename, right-click for more'}>
                <span class="n">{i + 1}</span><span class="nm">{songName(s, i)}</span>{#if s.duration}<span class="faint len">{clockOf(s.duration, false)}</span>{/if}</button>
              <button class="ghost more" onclick={(e) => songMenu(e, i)} aria-label="More for {songName(s, i)}" title="Rename, move, remove"><Icon name="more" size={14} /></button>
            </li>
          {/each}
        </ol>
      {/if}
      <button class="ghost add" onclick={newSong} title="A song at the end of the set, with its own file and cues"><Icon name="plus" size={14} />Add a song</button>
      {#if songs.length}
        <label class="opt">Count-in <select value={app.show.setlist?.countIn ?? 0} aria-label="Count-in" onchange={(e) => setCountIn(+(e.target as HTMLSelectElement).value)}>
          <option value={0}>none (the drummer counts)</option><option value={1}>1 bar of clicks</option></select></label>
        <label class="opt">Between songs <select value={between} aria-label="Between songs" onchange={(e) => setBetween((e.target as HTMLSelectElement).value)}>
          <option value="">the last look stays</option>
          {#each lists as l (l.id)}<optgroup label={l.name}>{#each l.cues as c, k (c.id)}<option value={JSON.stringify([l.id, c.id])}>{cueNumber(l, k)}. {c.name}</option>{/each}</optgroup>{/each}
        </select></label>
      {/if}
    </section>
    <div class="song">
      <button onclick={() => fileIn?.click()}><Icon name="music" />{tl?.audio ? 'Another song…' : 'Load a song…'}</button>
      <button class="ghost" class:on={(tl?.demo && !tl.audio) || !!tl?.audio?.catalog} onclick={() => (picking = true)} title="Real songs with vocals (free to use), or the demo beat">Demo songs…</button>
      <input type="file" accept="audio/*" hidden bind:this={fileIn} onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void loadSong(f); }} />
      {#if dl}<p class="dl" role="status"><progress max={dl.total || undefined} value={dl.total ? dl.got : undefined} aria-label="Downloading {dl.title}"></progress><span>{dl.title} {pct(dl)}</span><button class="ghost" onclick={cancel}>Cancel</button></p>{/if}
      {#if finding}<p class="dl" role="status"><progress aria-label="Finding the tempo of {finding}"></progress><span>Finding the tempo and parts…</span></p>{/if}
      {#if P.missing}<p class="err">"{P.missing}" isn't in this browser: {#if missingSong}<button class="ghost again" onclick={() => take(missingSong)}>download it again</button>{:else}load the file again.{/if}</p>{/if}
    </div>
    <div class="around" title="Time for the show before the song starts (an intro, the walk-on) and after it ends (the cheer, the house lights)">
      <label>Before the song <input type="number" min="0" max={AROUND_MAX} step="1" value={tl?.lead ?? 0} aria-label="Seconds before the song"
        onchange={(e) => { const el = e.target as HTMLInputElement; el.value = String(setAround('lead', el.valueAsNumber)); }} /> s</label>
      <label>After it <input type="number" min="0" max={AROUND_MAX} step="1" value={tl?.tail ?? 0} aria-label="Seconds after the song"
        onchange={(e) => { const el = e.target as HTMLInputElement; el.value = String(setAround('tail', el.valueAsNumber)); }} /> s</label>
    </div>
    {#each built ? lists : [] as l (l.id)}
      <h3>{l.name}</h3>
      <div class="chips">
        {#each l.cues as c, i (c.id)}
          {@const chip = { kind: 'cue', list: l.id, cue: c.id } as Chip}
          {@const risk = cueRiskOf(app.show, c, app.showRev)}
          <button class="chip" class:risky={risk === 'hazard' || risk === 'once'} draggable="true" ondragstart={(e) => dragChip(e, chip)} onclick={() => chipAt(chip, sn(P.position))}
                  title="Drag onto the timeline, or tap: at the playhead{risk === 'hazard' ? '. Fires a machine (flames, sparks or CO2) while armed' : risk === 'once' ? '. Fires confetti while armed' : ''}">{#if risk === 'hazard'}<Icon name="warn" size={11} />{:else if risk === 'once'}1× {/if}{cueNumber(l, i)}. {c.name}</button>
        {/each}
        {#if !l.cues.length}<span class="faint">No cues yet</span>{/if}
      </div>
    {/each}
    {#if app.show.effects.length}
      <h3>Effects</h3>
      <div class="chips">
        {#each app.show.effects as e (e.id)}
          {@const chip = { kind: 'fx', effect: e.id } as Chip}
          <button class="chip fx" draggable="true" ondragstart={(ev) => dragChip(ev, chip)} onclick={() => chipAt(chip, sn(P.position))}>{e.name}</button>
        {/each}
      </div>
    {/if}
    <h3>Moments</h3>
    <p class="note">Moments only fire while playing forward, and only with the machines armed.</p>
    <div class="chips">
      {#each BURSTS as b (b.attr)}
        {@const chip = { kind: 'burst', attr: b.attr, s: b.s } as Chip}
        <button class="chip mo" draggable="true" ondragstart={(e) => dragChip(e, chip)} onclick={() => chipAt(chip, sn(P.position))}>{b.label}</button>
      {/each}
      {#each [{ label: 'Blackout', a: { do: 'blackout', on: true } }, { label: 'Blackout off', a: { do: 'blackout', on: false } }, { label: 'Everything off', a: { do: 'off' } }] as m (m.label)}
        {@const chip = { kind: 'act', a: m.a as TimelineAction } as Chip}
        <button class="chip mo" draggable="true" ondragstart={(e) => dragChip(e, chip)} onclick={() => chipAt(chip, sn(P.position))}>{m.label}</button>
      {/each}
    </div>
    <h3>Crowd</h3>
    <div class="chips">
      {#each CROWD as c (c.label)}
        {@const chip = { kind: 'crowd', a: c.a, len: c.len } as Chip}
        <button class="chip cr" draggable="true" ondragstart={(e) => dragChip(e, chip)} onclick={() => chipAt(chip, sn(P.position))} title="{c.tip}. Drag onto the timeline, or tap: at the playhead">{c.label}</button>
      {/each}
    </div>
  </aside>

  <section class="main">
    <div class="preview">{#if shown || ui.stage3d}<StageView compact readonly />{/if}</div>
    <div class="transport" role="toolbar" aria-label="Transport">
      <button class="ghost" onclick={() => jump(P.start)} aria-label="Back to the start" title="Back to the start (Home)"><Icon name="back" /></button>
      <button class="primary play" onclick={() => P.toggle()} aria-label={P.playing ? 'Pause' : 'Play'} title="Play / pause (Space)"><Icon name={P.playing ? 'stop' : 'play'} />{P.playing ? 'Pause' : 'Play'}</button>
      <span class="clock" role="timer" aria-label="Position">{clockOf(at)} <span class="faint">/ {clockOf(P.duration, false)}</span></span>
      <label class="bpm">BPM <input type="number" min="40" max="240" value={tl?.bpm ?? app.show.settings.bpm} aria-label="Timeline BPM"
        onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; if (v >= 40 && v <= 240) { app.timeline.ensure().bpm = v; app.markDirty(0); } }} /></label>
      <span class="vol"><button class="ghost snd" class:off={!P.soundHere} aria-pressed={P.soundHere} onclick={() => P.setSoundHere(!P.soundHere)} aria-label="Sound here"
        title={P.soundHere ? "The song plays out of this device. Click for no sound here (a band playing live): the song's clock runs on" : 'No sound here: the song runs silently (a video of the 3D stage still gets it). Click for sound here'}><Icon name="music" size={14} /></button><input
        type="range" min="0" max="1" step="0.05" value={P.volume} oninput={(e) => P.setVolume(+(e.target as HTMLInputElement).value)} aria-label="Volume" title="How loud the song is (this browser)" /></span>
      {#if crowd.length}<span class="vol crowdvol"><button class="ghost snd" class:off={!P.crowdOn} aria-pressed={P.crowdOn} onclick={() => P.setCrowd(P.crowdVolume, !P.crowdOn)} aria-label="Crowd sound"
        title={P.crowdOn ? 'The crowd cheers along with the song. Click to leave it out' : 'No crowd sound. Click to hear the crowd again'}>Crowd</button><input
        type="range" min="0" max="1" step="0.05" value={P.crowdVolume} oninput={(e) => P.setCrowd(+(e.target as HTMLInputElement).value, true)} aria-label="Crowd volume" title="How loud the crowd is against the song (this browser)" /></span>{/if}
      <label>Snap <select bind:value={snapTo} aria-label="Snap"><option value="bar">to the bar</option><option value="beat">to the beat</option><option value="off">off</option></select></label>
      <button class="ghost" onclick={() => addPart()} aria-label="Add a part here" title="A new part of the song starts at the bar line nearest the playhead (P)"><Icon name="plus" size={14} />Part</button>
      <span class="grow"></span>
      <span class="chip armed" class:on={app.sfxArmed} title="Moments only fire while playing forward, and only with the machines armed (the button at the top)">{app.sfxArmed ? 'Machines armed' : 'Machines safe'}</span>
      {#if tl?.audio}<span class="faint name" title={tl.audio.name}>♪ {tl.audio.name}</span>{:else if tl?.demo}<span class="faint name">♪ demo beat</span>{/if}
      <button class="ghost" onclick={() => zoom(0.8)} aria-label="Zoom out"><Icon name="search" size={14} />−</button>
      <button class="ghost" onclick={() => (pps = 0)} title="The whole song">Fit</button>
      <button class="ghost" onclick={() => zoom(1.25)} aria-label="Zoom in"><Icon name="search" size={14} />+</button>
    </div>
    <div class="board">
      <div class="names">
        <div class="nr" title={songs.length > 1 ? `Song ${cur + 1} of ${songs.length}: ${songName(tl, cur)}` : undefined}>{songs.length > 1 ? `${cur + 1}. ${songName(tl, cur)}` : 'Song'}</div>
        {#each lanes as ln (ln.id)}<div class="nl" style="--c:{ln.color}">{ln.name}</div>{/each}
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions (drops from the palette; every item is a button of its own) -->
      <div class="tracks" bind:this={tracks} bind:clientWidth={() => width, (v) => { if (v > 0) width = v; }} onscroll={() => (scrolled = tracks!.scrollLeft)} ondragover={over} ondragleave={() => (dropAt = null)} ondrop={drop} onwheel={wheel}>
        <div class="inner" style="width:{Math.max(width, x(span.to) + 40)}px">
          {#each around as a (a.cls)}<span class="shade {a.cls}" style="left:{x(a.from)}px;width:{x(a.to) - x(a.from)}px" aria-hidden="true"></span>{/each}
          <!-- svelte-ignore a11y_no_static_element_interactions (the transport and the arrow keys do the same) -->
          <div class="ruler" onpointerdown={(e) => scrubDown(e, true)} onpointermove={scrubMove} onpointerup={scrubUp} onpointercancel={scrubUp} oncontextmenu={rulerMenu}>
            {#each around as a (a.cls)}
              <button class="span {a.cls}" style="left:{x(a.from)}px;width:{Math.max(6, x(a.to) - x(a.from) - 1)}px" onpointerdown={(e) => e.stopPropagation()} onclick={() => jump(a.from)}
                title="{a.name}: {clockOf(a.from, false)} to {clockOf(a.to, false)}. Click to go there." aria-label="Go to {a.name} ({clockOf(a.from, false)})">{a.name}</button>
            {/each}
            {#each grid as g (g.t)}<span class="tick" class:bar={g.bar} style="left:{x(g.t)}px">{#if g.bar}{g.n}{/if}</span>{/each}
            {#each sections as s, i (s.at)}
              <button class="sec" style="left:{x(s.at)}px;width:{Math.max(6, (s.end - s.at) * scale - 1)}px;--mix:{Math.round(8 + (s.energy ?? (i % 2 ? 0.25 : 0.5)) * 30)}%"
                onpointerdown={(e) => e.stopPropagation()} onclick={() => jump(s.at)} ondblclick={() => renamePart(s.at)} oncontextmenu={(e) => partMenu(e, s)}
                title="{s.name}: {clockOf(s.at, false)} to {clockOf(s.end, false)}. Click to go there, double-click to rename, right-click for more." aria-label="Go to {s.name} ({clockOf(s.at, false)})">{s.name}</button>
            {/each}
            <svg class="wave" style="left:{x(0)}px" width={(P.duration || 240) * scale} height="44" aria-hidden="true"><path d={peaksPath} /></svg>
          </div>
          {#each lanes as ln (ln.id)}
            <div class="lane" style="--c:{ln.color}">
              {#each built ? (ln.id === 'crowd' ? crowd : items.filter((i) => i.lane === ln.id)) : [] as it (it.id)}
                {@const mark = markOf(it)}
                <button class="it" class:bar={it.len !== undefined} class:sel={sel === it.id} style="left:{x(it.at)}px;{it.len !== undefined ? `width:${Math.max(10, it.len * scale)}px` : ''}"
                  onpointerdown={(e) => itemDown(e, it)} onpointermove={itemMove} onpointerup={itemUp} oncontextmenu={(e) => itemMenu(e, it)}
                  aria-label="{labelOf(it)} at {clockOf(it.at)}{mark === 'hazard' ? ', fires a machine' : mark === 'once' ? ', fires once' : ''}"
                  title="{labelOf(it)} at {clockOf(it.at)}{mark === 'hazard' ? ' (fires a machine)' : mark === 'once' ? ' (fires once)' : ''}: drag to move, right-click for more">
                  {#if mark === 'hazard'}<span class="mark hazard" aria-hidden="true"><Icon name="warn" size={12} /></span>{:else if mark === 'once'}<span class="mark once" aria-hidden="true">1×</span>{/if}
                  <span class="t">{labelOf(it)}</span>
                  {#if it.len !== undefined}<!-- svelte-ignore a11y_no_static_element_interactions -->
                    <span class="end" onpointerdown={(e) => itemDown(e, it, true)} onpointermove={itemMove} onpointerup={itemUp}></span>{/if}
                </button>
              {/each}
            </div>
          {/each}
          {#if dropAt !== null}<span class="drop" style="left:{x(dropAt)}px"></span>{/if}
          <!-- svelte-ignore a11y_no_static_element_interactions (Home, End and the arrows move it from the keyboard) -->
          <span class="playhead" class:held={scrubbing} style="left:{x(at)}px" onpointerdown={(e) => scrubDown(e)} onpointermove={scrubMove} onpointerup={scrubUp} onpointercancel={scrubUp}
            title="Drag to go through the song: the looks follow, nothing fires"></span>
        </div>
      </div>
    </div>
    {#if credit}<p class="credit">♪ {credit.text}{#if credit.s} · <a href={credit.s.licenseUrl} target="_blank" rel="noopener noreferrer">the licence</a> · <a href={credit.s.page} target="_blank" rel="noopener noreferrer">where it's from</a>{/if}</p>{/if}
    {#if !items.length}<p class="hint empty">Drag a cue from the left onto the tracks (or tap it), pick a song or a demo song, and press Play.</p>{/if}
  </section>
</div>

{#snippet listenButton(s: CatalogSong | null, name: string)}
  {@const on = listening === (s?.id ?? 'demo')}
  <button class="ghost listen" class:on aria-pressed={on} onclick={() => listen(s)} aria-label="{on ? 'Stop' : 'Listen to'} {name}" title="A short listen (15 s)"><Icon name={on ? 'stop' : 'play'} />{on ? 'Stop' : 'Listen'}</button>
{/snippet}

{#if picking}
  <Modal title="Demo songs" onclose={closePicker} wide>
    <p class="hint">Real songs with vocals, free to use under their Creative Commons licences (the credit stays with your show). Picking one downloads it into this browser; its tempo and its parts come with it, and cues snap to the parts.</p>
    <h3 class="genre">Made in the app</h3>
    <ul class="songs">
      <li class:cur={!!tl?.demo && !tl.audio}>
        {@render listenButton(null, 'Demo beat')}
        <div class="info"><b>Demo beat</b> <span class="meta">Club · 126 BPM · {clockOf(DEMO_SECONDS, false)}</span><span class="blurb">Ten minutes with builds and drops, made in the app: nothing to download. The big demo show runs on it.</span></div>
        {#if tl?.demo && !tl.audio}<span class="chip green">On the timeline</span>{:else}<button class="primary" onclick={takeDemo} aria-label="Use Demo beat">Use</button>{/if}
      </li>
    </ul>
    {#each byGenre as [genre, songs] (genre)}
      <h3 class="genre">{genre}</h3>
      <ul class="songs">
        {#each songs as s (s.id)}
          {@const cur = tl?.audio?.catalog === s.id && !P.missing}
          <li class:cur>
            {@render listenButton(s, s.title)}
            <div class="info">
              <b>{s.title}</b> <span>{s.artist}</span> <span class="meta">{s.bpm} BPM · {clockOf(s.duration, false)}</span>
              <span class="blurb"><a href={s.licenseUrl} target="_blank" rel="noopener noreferrer">{s.license}</a> · <a href={s.page} target="_blank" rel="noopener noreferrer">where it's from</a></span>
              {#if dl?.id === s.id}<span class="dl"><progress max={dl.total || undefined} value={dl.total ? dl.got : undefined} aria-label="Downloading {s.title}"></progress>{pct(dl)}</span>{/if}
            </div>
            {#if cur}<span class="chip green">On the timeline</span>
            {:else if dl?.id === s.id}<button onclick={cancel} aria-label="Stop downloading {s.title}">Cancel</button>
            {:else}<button class="primary" onclick={() => take(s)} aria-label="Use {s.title}">Use</button>{/if}
          </li>
        {/each}
      </ul>
    {/each}
  </Modal>
{/if}

<style>
  .tlv { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(200px, 250px) minmax(0, 1fr); gap: .55rem; padding: .55rem; }
  .pal { overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: .55rem; display: flex; flex-direction: column; gap: .35rem; }
  .pal h3 { margin: .5rem 0 0; font-size: .74rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .song { display: flex; gap: .35rem; flex-wrap: wrap; }
  /* the set list: one row a song, the one on the tracks marked */
  .set { display: flex; flex-direction: column; gap: .25rem; }
  .set h3 { margin-top: .2rem; }
  .setlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .2rem; }
  .setlist li { display: flex; align-items: stretch; gap: .15rem; }
  .setlist .pick { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: .4rem; justify-content: flex-start; padding: .25rem .45rem; border-radius: var(--radius-s);
    border: 1px solid var(--line); background: var(--panel2); color: var(--text); text-align: left; font-size: .84rem; }
  .setlist .cur .pick { border-color: var(--green); background: #45d85c14; }
  .setlist .n { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 1.1em; }
  .setlist .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .setlist .len { font-size: .74rem; font-variant-numeric: tabular-nums; }
  .setlist .more { padding: 0 .3rem; min-height: 0; }
  .set .add { align-self: flex-start; font-size: .82rem; }
  .set .opt { display: flex; align-items: center; gap: .4rem; font-size: .8rem; color: var(--muted); }
  .set .opt select { flex: 1; min-width: 0; font-size: .8rem; }
  .snd.off { color: var(--faint); text-decoration: line-through; }
  .vol .snd { min-height: 0; padding: .15rem .3rem; }
  .chips { display: flex; flex-wrap: wrap; gap: .25rem; }
  .chip { cursor: grab; font-size: .8rem; padding: .15rem .5rem; border-radius: 999px; border: 1px solid var(--line2); background: var(--panel2); color: var(--text); min-height: 0; }
  .chip.fx { border-color: #ffaa1c66; } .chip.mo { border-color: #f33abc66; } .chip.cr { border-color: #7fc8ff66; }
  /* the time before and after the song: two small fields under the song */
  .around { display: flex; flex-wrap: wrap; gap: .2rem .6rem; font-size: .8rem; color: var(--muted); }
  .around label { display: inline-flex; align-items: center; gap: .3rem; }
  .around input { width: 4.2em; font-size: .8rem; }
  .chip.risky { color: var(--orange); display: inline-flex; align-items: center; gap: .2rem; }
  .main { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(140px, 1fr) auto minmax(160px, auto) auto; gap: .45rem; }
  .preview { min-height: 0; display: flex; overflow: hidden; }      /* (never over the transport) */
  .preview :global(.stage-wrap) { flex: 1; }
  .transport { display: flex; align-items: center; gap: .45rem; flex-wrap: wrap; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: .35rem .5rem; }
  .play { min-width: 6.5rem; }
  .clock { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 1.05rem; }
  .bpm input { width: 4.2em; }
  .vol { display: inline-flex; align-items: center; gap: .3rem; } .vol input { width: 6rem; }
  .name { max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grow { flex: 1; }
  .board { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
  /* many lanes on a short screen: they scroll, the stage picture and the transport keep their room */
  .board { max-height: 52vh; overflow-y: auto; }
  .names { border-right: 1px solid var(--line); }
  .nr { height: 78px; display: flex; align-items: flex-end; padding: .3rem .5rem; color: var(--muted); font-size: .8rem; border-bottom: 1px solid var(--line); overflow: hidden; overflow-wrap: anywhere; }
  .nl { height: 38px; display: flex; align-items: center; padding: 0 .5rem; font-size: .82rem; border-bottom: 1px solid var(--line); border-left: 3px solid var(--c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tracks { overflow-x: auto; overflow-y: hidden; position: relative; }
  .inner { position: relative; }
  .ruler { height: 78px; position: relative; border-bottom: 1px solid var(--line); cursor: text; background: #0b0f15; }
  .tick { position: absolute; top: 0; height: 12px; border-left: 1px solid #2a313c; font-size: .66rem; color: var(--faint); padding-left: 2px; }
  .tick.bar { height: 16px; border-left-color: #3b4450; }
  /* the song's parts: a band under the bar numbers, stronger where it's louder; a click goes there */
  .sec { position: absolute; top: 15px; height: 16px; min-height: 0; display: block; padding: 0 4px; border: 0; border-left: 2px solid var(--accent); border-radius: 0;
    background: color-mix(in srgb, var(--accent) var(--mix), #0b0f15); color: var(--text); font-size: .66rem; line-height: 16px; text-align: left;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; z-index: 1; }
  .sec:hover { filter: brightness(1.3); }
  .wave { position: absolute; left: 0; top: 32px; pointer-events: none; }
  /* before and after the song: hatched, named on the ruler, faintly behind the tracks */
  .span { position: absolute; top: 15px; height: 16px; min-height: 0; display: block; padding: 0 4px; border: 0; border-radius: 0; z-index: 1; cursor: pointer;
    background: repeating-linear-gradient(135deg, #ffffff14 0 5px, transparent 5px 10px), #151b25; color: var(--muted); font-size: .66rem; line-height: 16px;
    text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .span.lead { border-right: 2px solid var(--muted); text-align: right; } .span.tail { border-left: 2px solid var(--muted); }
  .span:hover { color: var(--text); }
  .shade { position: absolute; top: 0; bottom: 0; pointer-events: none; background: repeating-linear-gradient(135deg, #ffffff08 0 8px, transparent 8px 16px), #0000001f; }
  .vol .snd:not(:has(svg)) { font-size: .78rem; }
  .wave path { fill: #6aa2ff55; stroke: #6aa2ff; stroke-width: .5; }
  .lane { height: 38px; position: relative; border-bottom: 1px solid var(--line); background: repeating-linear-gradient(90deg, transparent 0 1px, transparent 1px 100%); }
  .it { position: absolute; top: 5px; height: 28px; transform: translateX(-1px); min-width: 0; max-width: 18rem; padding: 0 .45rem 0 .5rem; border-radius: 6px; border: 1px solid var(--c);
    background: color-mix(in srgb, var(--c) 22%, var(--panel2)); color: var(--text); font-size: .74rem; display: flex; align-items: center; cursor: grab; touch-action: none; overflow: hidden; }
  .it::before { content: ''; position: absolute; left: -1px; top: -5px; bottom: -5px; width: 2px; background: var(--c); }
  .it.bar { max-width: none; }
  .it.sel { outline: 2px solid var(--accent); outline-offset: 1px; z-index: 2; }
  .it .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
  .end { position: absolute; right: 0; top: 0; bottom: 0; width: 8px; cursor: ew-resize; background: color-mix(in srgb, var(--c) 50%, transparent); }
  /* (not .head: the palette's heading row is a .head too, and became this line down the whole page) */
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--green); box-shadow: 0 0 8px #45d85c88; z-index: 3; cursor: ew-resize; touch-action: none; }
  /* a grab wider than the line, all the way down over the lanes */
  .playhead::before { content: ''; position: absolute; top: 0; bottom: 0; left: -7px; width: 16px; }
  .playhead.held, .playhead:hover { box-shadow: 0 0 0 1px #45d85c66, 0 0 12px #45d85caa; }
  .mark { flex: none; display: inline-flex; align-items: center; margin-right: .25rem; pointer-events: none; }
  .mark.hazard { color: var(--orange); }
  .mark.once { font-size: .64rem; font-weight: 700; padding: 0 .2rem; border-radius: 3px; background: #ffffff1c; }
  .note { margin: 0; font-size: .74rem; color: var(--faint); }
  .armed.on { color: var(--pink); border-color: #f33abc88; background: #f33abc1a; }
  .drop { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent); pointer-events: none; }
  .empty { margin: 0; }
  .err { color: var(--pink); font-size: .82rem; margin: .2rem 0 0; }
  .songs { list-style: none; margin: .4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
  .songs li { display: flex; align-items: center; gap: .6rem; padding: .4rem .5rem; border: 1px solid var(--line); border-radius: var(--radius-s); background: var(--panel2); }
  .songs li.cur { border-color: #45d85c66; }
  .songs .info { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 .5rem; }
  .songs .meta { color: var(--muted); font-size: .8rem; font-variant-numeric: tabular-nums; }
  .songs .blurb { flex-basis: 100%; color: var(--faint); font-size: .8rem; }
  .songs .listen { min-width: 5.6rem; justify-content: flex-start; }
  .songs .blurb a { color: var(--muted); }
  .genre { margin: .8rem 0 0; font-size: .74rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .dl { display: flex; align-items: center; gap: .4rem; margin: .2rem 0 0; font-size: .8rem; color: var(--muted); flex-basis: 100%; }
  .dl progress { flex: 1; max-width: 12rem; accent-color: var(--accent); }
  .song .dl span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .again { padding: 0 .2rem; color: var(--accent); text-decoration: underline; }
  .credit { margin: 0; font-size: .8rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .credit a { color: var(--muted); }
  @media (max-width: 760px) {
    .tlv { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
    .pal { max-height: 30vh; }
    .preview { display: none; }
    .main { grid-template-rows: auto minmax(160px, 1fr) auto; }
  }
</style>
