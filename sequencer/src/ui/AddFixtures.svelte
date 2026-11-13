<script lang="ts">
  // Adding lights. One dialog: a search box over the built-in types AND the fixture libraries
  // (2400+ from the Open Fixture Library and QLC+), live as you type; what it finds and the
  // built-in types as tiles, each with its light playing what it can do (FixturePreview: the 3D
  // stage's own models); the one picked big on the right with its modes and channels, how many,
  // where, and Add. A file, your own type, a ring or a matrix: the buttons under the search box.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import FixturePreview from './FixturePreview.svelte';
  import FixtureEditor from './FixtureEditor.svelte';
  import { app } from '../app.svelte';
  import { spansOf } from '../model/pixelLayout';
  import PixelShapeMaker from './PixelShapeMaker.svelte';
  import { GENERIC, KIND_LABEL, caps, kindOf, modeOf, typeLabel } from '../model/library';
  import { fetchType, loadCatalog, POPULAR_MAKERS, search, type Entry } from '../library/catalog';
  import { ATTR_LABEL } from './attrs';
  import { importFixtureFile } from '../import/file';
  import { ui } from './ui.svelte';
  import type { FixtureType } from '../model/types';
  import type { FixtureKind } from '../model/library';

  let { onclose }: { onclose: () => void } = $props();
  const BLURB: Record<string, string> = {
    'gen-dimmer': 'One channel: a dimmer pack, a bulb, house lights.',
    'gen-rgb': 'Red, green, blue. Brightness comes from the colours.',
    'gen-drgb': 'Dimmer first, then RGB. The most common cheap PAR.',
    'gen-rgbd': 'RGB first, then the dimmer.',
    'gen-rgbw': 'RGB plus a white LED for real white.',
    'gen-drgbw': 'Dimmer, RGB and white.',
    'gen-drgbws': 'Dimmer, RGBW and a strobe channel.',
    'gen-rgba': 'RGB plus amber, for warmer colours.',
    'gen-drgbwauvs': 'The 6-in-1 PAR: RGBW, amber, UV, strobe.',
    'gen-cct': 'Dimmer and colour temperature.',
    'gen-wwcw': 'Warm and cool white LEDs.',
    'gen-strobe': 'Dimmer and strobe rate.',
    'gen-fog': 'One channel: fog output.',
    'gen-hazer': 'Haze and fan.',
    'gen-mover8': 'Pan, tilt, dimmer, RGB, strobe, speed.',
    'gen-mover16': 'Fine pan/tilt for smooth moves, RGBW.',
    'gen-drgbsms': 'Dimmer, RGB, strobe, a built-in mode and its speed.',
    'gen-drgbwsms': 'Dimmer, RGBW, strobe, a built-in mode and its speed.',
    'gen-haze1': 'One channel: haze output.',
    'gen-blinder2': 'Two lamps on one dimmer: the audience blinder.',
    'gen-confetti': 'Fires once. Only while the machines are armed.',
    'gen-bubbles': 'Bubbles and the fan that blows them.',
    'gen-flame': 'Fires a flame. Only while the machines are armed.',
    'gen-sparks': 'Cold sparks. Only while the machines are armed.',
    'gen-co2': 'A CO2 jet. Only while the machines are armed.',
    'gen-wash': 'An RGBW wash with zoom, 16-bit pan and tilt.',
    'gen-spotgobo': 'Gobos turning either way, a prism, zoom, focus.',
    'gen-endless': 'Pan and tilt that turn round and round.',
    'gen-roll': 'A third axis: the head turns round its own beam.',
    'gen-headbar4': 'Four heads in a row, each tilting on its own.',
    'gen-winch': 'Height, speed, motion enable: moves only while armed.',
    'gen-profile': 'Two gobo wheels, animation wheel, prisms, iris, frost.',
  };
  // (a pixel strip: what its pixels are and how many channels each takes)
  const stripBlurb = (t: FixtureType) => (t.id.startsWith('gen-strip') ? `One light, ${t.id.endsWith('w') ? '4 channels a pixel (RGBW)' : '3 channels a pixel (RGB)'}, drawn cell by cell.`
    : t.id.startsWith('gen-bar') ? 'A batten of RGB cells: one colour each, or chases along it.' : undefined);
  let typeId = $state('gen-drgb');
  let count = $state(4), universe = $state(0), name = $state('PAR'), mode = $state('');
  let address = $state<number | null>(null);   // empty = next free
  let make = $state(false), shapeMaker = $state(false);
  let err = $state('');
  let fileInput = $state<HTMLInputElement>();

  // ---- the libraries: their index comes once (a few hundred kB), a fixture when it's picked
  let all = $state.raw<Entry[]>([]);
  let libErr = $state('');
  loadCatalog().then((e) => (all = e)).catch(() => (libErr = "Couldn't load the fixture library index (offline?). The built-in types are all here."));
  let q = $state('');
  const query = $derived(q.trim());
  const results = $derived(query ? search(all, q, 48) : []);
  // a library fixture once it has come down, by entry (its tile then plays the real thing)
  let fetched = $state.raw<Record<string, FixtureType>>({});
  const ek = (e: Entry) => `${e.source}:${e.key}`;
  let libType = $state.raw<FixtureType | null>(null);     // the library one picked (in the show once added)
  let chosen = $state.raw<Entry | null>(null);
  let loading = $state.raw<Entry | null>(null);
  let pickNo = 0;
  async function choose(e: Entry) {
    const no = ++pickNo;
    libErr = ''; err = ''; loading = e; chosen = e;
    try {
      const t = fetched[ek(e)] ?? await fetchType(e);
      if (no !== pickNo) return;
      fetched = { ...fetched, [ek(e)]: t };
      libType = t;
      pick(t.id, t);
    } catch (x) { if (no === pickNo) libErr = (x as Error).message + ' (needs an internet connection the first time)'; }
    if (no === pickNo) loading = null;
  }
  // a library tile before its fixture has come down: a built-in one of its kind plays for it
  const STAND_IN: [RegExp, string][] = [
    [/moving head.*wash|wash.*moving head/i, 'gen-wash'], [/moving head|spot|beam|profile/i, 'gen-spotgobo'], [/scanner/i, 'gen-mover8'],
    [/matrix|pixel|led bar|batten/i, 'gen-bar12'], [/blinder/i, 'gen-blinder2'], [/strobe/i, 'gen-strobe'], [/hazer|haze/i, 'gen-hazer'], [/smoke|fog/i, 'gen-fog'],
    [/dimmer/i, 'gen-dimmer'], [/color changer|colour|par|wash/i, 'gen-drgbw'],
  ];
  const generic = (id: string) => GENERIC.find((t) => t.id === id)!;
  function standIn(e: Entry): FixtureType {
    // (its category first: an "IP Spot" that's a colour changer isn't a moving head)
    const cats = (e.categories ?? []).join(' ');
    return generic((cats && STAND_IN.find(([re]) => re.test(cats))?.[1]) || STAND_IN.find(([re]) => re.test(e.name))?.[1] || 'gen-drgb');
  }
  // what a library entry says about itself, short
  const modesSaid = (e: Entry) => (e.modes?.length ? `${e.modes.length} mode${e.modes.length > 1 ? 's' : ''}, ${Math.min(...e.modes.map((m) => m[1]))}${e.modes.length > 1 && Math.max(...e.modes.map((m) => m[1])) !== Math.min(...e.modes.map((m) => m[1])) ? `-${Math.max(...e.modes.map((m) => m[1]))}` : ''} ch` : '');

  // ---- the built-in and this show's types, and mine from other shows
  const type = $derived(app.types.get(typeId) ?? app.myTypes.find((t) => t.id === typeId) ?? (libType?.id === typeId ? libType : undefined));
  $effect(() => { if (type && !type.modes.some((m) => m.name === mode)) mode = type.modes[0].name; });
  const width = $derived(modeOf(type, mode)?.channels.length ?? 1);
  const nextFree = $derived(app.nextFree(universe, width));
  const wideSpans = $derived(spansOf({ universe: 0, address: 1 }, modeOf(type, mode)).length);
  // Lights already on the channels these would take (a template's PARs on 1-24, say).
  const overlaps = $derived.by(() => {
    if (!address || address < 1 || width > 512) return [] as string[];
    const a0 = address, a1 = address + count * width - 1;
    return app.show.fixtures.filter((f) => f.universe === universe && f.address <= a1 && a0 <= f.address + (app.modeOf(f.id)?.channels.length ?? 1) - 1).map((f) => f.name);
  });
  const allTypes = $derived([...GENERIC.filter((t) => !t.id.startsWith('gen-bar') || t.id === 'gen-bar8' || t.id === 'gen-bar12'), ...app.show.fixtureTypes]);
  // rings and matrices in a row of their own: down in a long list nobody finds them
  const shapeTypes = $derived(allTypes.filter((t) => t.modes[0]?.layout));
  const shownTypes = $derived(allTypes.filter((t) => !t.modes[0]?.layout));
  // My fixtures from other shows (the ones this show has already are listed with the rest).
  const mine = $derived(app.myTypes.filter((t) => !app.show.fixtureTypes.some((x) => x.id === t.id)));
  // the built-in ones a search finds ("generic moving head", "gobo", "strobe"): by their name, what
  // they are and their channels, at the start of a word ("robe" isn't a strobe)
  const builtIn = $derived.by(() => {
    const words = query.toLowerCase().replace(/\bgeneric\b/g, '').split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return [];
    return [...allTypes, ...mine].filter((t) => {
      const m = modeOf(t, ''), k = kindOf(m);
      const text = ` ${typeLabel(t)} ${KIND_LABEL[k]} ${BLURB[t.id] ?? ''} ${m?.channels.map((c) => c.attr).join(' ')}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      return words.every((w) => text.includes(' ' + w));
    }).slice(0, 8);
  });

  // The coloured dots on a type card: what light it makes, and whether it moves.
  const DOT: Record<string, [string, string]> = {
    intensity: ['#d7dde6', 'dimmer'], red: ['#ff3b3b', 'red'], green: ['#3bff5c', 'green'], blue: ['#3b6bff', 'blue'],
    white: ['#ffffff', 'white'], amber: ['#ffae2b', 'amber'], uv: ['#9a5bff', 'UV'], cyan: ['#00e5ff', 'cyan'], magenta: ['#ff3bd8', 'magenta'],
    yellow: ['#fff23b', 'yellow'], warmWhite: ['#ffc98a', 'warm white'], coolWhite: ['#d8ecff', 'cool white'], colorWheel: ['conic-gradient(red,yellow,lime,cyan,blue,magenta,red)', 'colour wheel'],
  };
  const dots = (t: FixtureType) => {
    const attrs = new Set(modeOf(t, '')?.channels.map((c) => c.attr));
    return Object.entries(DOT).filter(([a]) => attrs.has(a as never)).map(([, d]) => d);
  };
  // what it can do, as a few words (the tile's chips; the preview says the rest)
  const CAN: [string, string][] = [['pan', 'pan/tilt'], ['gobo', 'gobos'], ['prism', 'prism'], ['zoom', 'zoom'], ['strobe', 'strobe'], ['colorWheel', 'colour wheel'], ['animation', 'animation'], ['iris', 'iris'], ['frost', 'frost'], ['hoist', 'hoist']];
  const can = (t: FixtureType) => { const a = new Set(modeOf(t, '')?.channels.map((c) => c.attr)); return CAN.filter(([x]) => a.has(x as never)).map(([, w]) => w).slice(0, 4); };
  // a ring or a matrix: how it's laid out, so you can tell which is yours
  const shapeBlurb = (t: FixtureType) => {
    const l = t.modes[0]?.layout;
    if (!l) return undefined;
    if (l.kind === 'matrix') {
      const corner = { tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' }[l.from ?? 'tl'];
      return `Data in at the ${corner}, ${l.zigzag ? 'in a zigzag ' : ''}along the ${l.vertical ? 'columns' : 'rows'}. Wired or hung differently? Its LEDs tab turns it, mirrors it, or finds the wiring on the real one.`;
    }
    return l.rings.length > 1 ? `Rings of ${l.rings.join(', ')}, data in at the rim. Common as a round AliExpress disc.` : 'One light with a shape, so effects can draw on it.';
  };
  const blurbOf = (t: FixtureType) => BLURB[t.id] ?? shapeBlurb(t) ?? stripBlurb(t) ?? `${t.modes.length} mode${t.modes.length > 1 ? 's' : ''}, from ${t.source === 'ofl' ? 'the Open Fixture Library' : t.source === 'qxf' ? 'QLC+' : t.source === 'gdtf' ? 'a GDTF file' : 'your own'}.`;
  // (a ring, a disc or a matrix said "Pixel bar": its layout says what it is)
  function kindTitle(t: FixtureType, k: FixtureKind) {
    const lay = modeOf(t, '')?.layout;
    return !lay ? KIND_LABEL[k] : lay.kind === 'matrix' ? 'Pixel matrix' : lay.rings.length > 1 ? 'Pixel disc' : 'Pixel ring';
  }
  // The keyboard: arrows move between the tiles (by where they are), Enter or Space picks one and
  // goes on to How many (it took some 60 Tabs to get from a type to Add)
  function cardKey(e: KeyboardEvent) {
    const here0 = e.currentTarget as HTMLElement;
    const cards = () => [...here0.closest('[role=dialog]')!.querySelectorAll<HTMLElement>('.tcard')].filter((b) => b.offsetParent);
    // (Home and End: the first and the last card)
    if (e.key === 'Home' || e.key === 'End') { const c = cards(); e.preventDefault(); (e.key === 'Home' ? c[0] : c[c.length - 1])?.focus(); return; }
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (!d) return;
    e.preventDefault();
    const c = (b: HTMLElement) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const from = c(here0);
    let best: HTMLElement | undefined, bd = Infinity;
    for (const b of cards()) {
      if (b === here0) continue;
      const p = c(b), along = (p.x - from.x) * d[0] + (p.y - from.y) * d[1];
      if (along <= 4) continue;
      const dist = along + 3 * Math.abs((p.x - from.x) * d[1] - (p.y - from.y) * d[0]);
      if (dist < bd) { bd = dist; best = b; }
    }
    // (up from the first row: back to the search box)
    if (!best && d[1] === -1) { searchBox?.focus(); return; }
    best?.focus();
  }
  let searchBox = $state<HTMLInputElement>();
  const toCount = () => setTimeout(() => { const el = document.querySelector<HTMLInputElement>('[role=dialog] input[aria-label="How many"]'); el?.focus(); el?.select(); });
  function pick(id: string, given?: FixtureType) {
    typeId = id;
    err = '';                                   // (another type picked: an old problem doesn't stand over it)
    likePick = null;
    if (!given) { libType = null; chosen = null; }
    const t = given ?? app.types.get(id) ?? app.myTypes.find((x) => x.id === id);
    const k = kindOf(modeOf(t, ''));
    const c = caps(modeOf(t, ''));
    const haze = modeOf(t, '')?.channels.some((x) => x.attr === 'haze');
    name = t && t.source !== 'generic' ? t.model : k === 'mover' ? 'Head' : k === 'bar' ? 'Bar' : k === 'fog' ? (haze ? 'Hazer' : 'Fog') : k === 'sfx' ? typeLabel(t!).split(' ')[0] : k === 'strobe' ? 'Strobe'
      : k === 'dimmer' ? 'Dimmer' : !c.color && c.cct ? 'White' : 'PAR';
    if (given) mode = given.modes[0]?.name ?? '';
    // People own PARs in fours, heads in pairs, and one fog machine.
    count = k === 'fog' || k === 'sfx' || k === 'strobe' ? 1 : k === 'mover' ? 2 : k === 'bar' ? 2 : 4;
    // a ring or a matrix: one, called what it is
    const shape = modeOf(t, '')?.layout;
    if (shape) { count = 1; if (t?.source === 'generic') name = shape.kind === 'matrix' ? 'Matrix' : shape.rings.length > 1 ? 'Disc' : 'Ring'; }
  }
  // the search box: Down into the tiles, Enter takes the first one found (Enter again: How many)
  function searchKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector<HTMLElement>('[role=dialog] .tcard')?.focus(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const b = builtIn[0], r = results[0];
    if (b && b.id === typeId) return toCount();
    if (r && chosen && (chosen === r || chosen === r.alt || chosen.key === r.key) && libType && !loading) return toCount();
    if (b && !r) return pick(b.id);
    if (r) return void choose(r);
    if (b) pick(b.id);
  }
  // In the looks: new lights can do what one that's there does (a template's looks with your own
  // lights). Offered when there are looks; a light of the same type first, then of the same kind.
  const hasLooks = $derived(app.show.cueLists.some((l) => l.cues.length));
  const likes = $derived.by(() => {
    if (!hasLooks || !type) return [];
    const k = kindOf(modeOf(type, mode)), c = caps(modeOf(type, mode));
    const inLooks = (id: string) => app.show.cueLists.some((l) => l.cues.some((q) => q.values[id]));
    const score = (f: { id: string; typeId: string; universe: number }) => {
      if (!inLooks(f.id)) return 0;
      if (f.typeId === typeId) return f.universe === universe ? 3 : 2.5;
      const m = app.modeOf(f.id);
      return kindOf(m) === k ? 2 : !!caps(m).color === !!c.color && k !== 'fog' && kindOf(m) !== 'fog' ? 1 : 0;
    };
    return app.show.fixtures.map((f) => ({ f, s: score(f) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  });
  const LIKE_GROUPS = [['The same light', 2.5, 9], ['The same kind', 2, 2.5], ['Others', 0, 2]] as const;
  const manyUnis = $derived(new Set(app.show.fixtures.map((f) => f.universe)).size > 1);
  // null: the suggestion, a light of the same type or kind on the same universe (a different kind,
  // or lights on another universe, the hall's bars next to the church's PARs: offered, not chosen)
  let likePick = $state<string | null>(null);
  const like = $derived(likePick ?? (likes[0] && likes[0].s >= 2 && likes[0].f.universe === universe ? likes[0].f.id : ''));
  function add() {
    err = '';
    const my = app.myTypes.find((t) => t.id === typeId);
    let id = typeId;
    if (my && !app.show.fixtureTypes.some((t) => t.id === typeId)) id = app.addType(my);
    else if (libType && libType.id === typeId && !app.show.fixtureTypes.some((t) => t.id === typeId)) id = app.addType(libType);
    const before = app.show.fixtures.length;
    err = app.addFixtures(id, mode, Math.max(1, Math.min(96, count | 0)), Math.max(0, universe | 0), name.trim() || 'Fixture', address && address > 0 ? address : undefined);
    const n = app.show.fixtures.length - before;
    if (n) {
      app.selected = app.show.fixtures.slice(before).map((f) => f.id);
      const src = like ? app.show.fixtures.find((f) => f.id === like) : undefined;
      const cues = src ? app.playAlong(app.selected, src.id) : 0;
      ui.toast(cues ? `Added ${n} × ${name}. In your ${cues} look${cues === 1 ? '' : 's'} they do what ${src!.name} does (Ctrl+Z takes it back)` : `Added ${n} × ${name}`, 5000);
      onclose();
      // (the keyboard goes on in the fixture list, the new lights selected there: Ctrl+A, the
      // arrows; the button that opened this may be gone, "Add your first lights")
      setTimeout(() => document.querySelector<HTMLElement>('.fl .olist')?.focus({ preventScroll: true }));
    }
  }
  async function file() {
    const f = fileInput?.files?.[0];
    if (fileInput) fileInput.value = '';
    if (!f) return;
    err = '';                                   // (the last file's problem isn't this one's)
    try { pick(app.addType(await importFixtureFile(f))); } catch (e) { err = (e as Error).message; }
  }
  // the tile under the pointer or the keyboard plays at full speed
  let hot = $state('');
  // (from the gallery's Add: that light picked)
  if (ui.addType) { const id = ui.addType; ui.addType = null; queueMicrotask(() => pick(id)); }
  const picked = $derived(modeOf(type, mode));
</script>

{#snippet typeCard(t: FixtureType, mineToo = false)}
  {@const k = kindOf(modeOf(t, ''))}
  <div class="tw">
    <button class="tcard" class:cur={t.id === typeId} onclick={(e) => { pick(t.id); if (e.detail === 0) toCount(); }} onkeydown={cardKey} title={kindTitle(t, k)} aria-pressed={t.id === typeId} data-type={t.id}
            onpointerenter={() => (hot = t.id)} onpointerleave={() => { if (hot === t.id) hot = ''; }} onfocus={() => (hot = t.id)} onblur={() => { if (hot === t.id) hot = ''; }}>
      <span class="pvbox"><FixturePreview type={t} hover={hot === t.id} /><span class="kind">{kindTitle(t, k)}</span></span>
      <span class="tt"><b>{t.source === 'generic' ? t.model : typeLabel(t)}</b>
        <span class="faint">{blurbOf(t)}</span></span>
      <span class="foot">
        <span class="chip">{modeOf(t, '')?.channels.length} ch</span>
        {#each can(t) as w (w)}<span class="chip can">{w}</span>{/each}
        <span class="dots">{#each dots(t) as [c, title] (title)}<span class="dot" style="background:{c}" {title}></span>{/each}</span>
      </span>
    </button>
    {#if mineToo}<button class="ghost forget" title="Forget it in this browser (shows that use it keep their copy)" aria-label="Forget {typeLabel(t)}" onclick={() => app.forgetMyType(t.id)}><Icon name="close" size={12} /></button>{/if}
  </div>
{/snippet}

{#snippet libCard(e: Entry)}
  {@const real = fetched[ek(e)]}
  {@const on = !!chosen && !!libType && (chosen === e || chosen === e.alt || chosen.key === e.key) && typeId === libType.id}
  <div class="tw">
    <button class="tcard lib" class:cur={on} class:busy={loading === e} onclick={(ev) => { void choose(e).then(() => { if (ev.detail === 0) toCount(); }); }} onkeydown={cardKey} aria-pressed={on} data-entry={ek(e)}
            onpointerenter={() => (hot = ek(e))} onpointerleave={() => { if (hot === ek(e)) hot = ''; }} onfocus={() => (hot = ek(e))} onblur={() => { if (hot === ek(e)) hot = ''; }}>
      <span class="pvbox"><FixturePreview type={real ?? standIn(e)} hover={hot === ek(e)} />
        <span class="kind">{e.categories?.[0] ?? 'Fixture'}</span>
        {#if !real}<span class="stand" title="A built-in one of its kind plays until this one has come down (pick it)">like this</span>{/if}
        {#if loading === e}<span class="stand">loading…</span>{/if}</span>
      <span class="tt"><span class="man">{e.manufacturer}</span><b>{e.name}</b></span>
      <span class="foot">
        {#if modesSaid(e)}<span class="chip">{modesSaid(e)}</span>{/if}
        <span class="src {e.source}">{e.source === 'ofl' ? 'OFL' : 'QLC+'}</span>{#if e.alt}<span class="src {e.alt.source}">{e.alt.source === 'ofl' ? 'OFL' : 'QLC+'}</span>{/if}
        {#if real}{#each can(real) as w (w)}<span class="chip can">{w}</span>{/each}{/if}
      </span>
    </button>
  </div>
{/snippet}

{#if make}<FixtureEditor onclose={() => (make = false)} onsaved={(id) => pick(id)} />
{:else if shapeMaker}<PixelShapeMaker onclose={() => (shapeMaker = false)} onsaved={(id) => pick(id)} />
{:else}
<Modal title="Add fixtures" {onclose} wide xl top>
  <div class="cols">
    <div class="main">
      <div class="search">
        <Icon name="search" size={18} />
        <!-- svelte-ignore a11y_autofocus (the dialog is for finding a light: the box is where it starts) -->
        <input type="search" bind:this={searchBox} bind:value={q} onkeydown={searchKey} autofocus aria-label="Search fixtures"
               placeholder="A maker, a model, or what it is: 'cameo flat', 'robin spot', 'moving head', 'gobo'" />
        <span class="n">{all.length ? `${all.length + allTypes.length} fixtures` : libErr ? '' : 'loading…'}</span>
      </div>
      <div class="row sources">
        <button onclick={() => fileInput?.click()}><Icon name="upload" />GDTF / QLC+ / OFL file…</button>
        <button onclick={() => (make = true)}><Icon name="wizard" />Make my own…</button>
        <button onclick={() => (shapeMaker = true)}><Icon name="sun" />Ring or matrix…</button>
        <button class="ghost" onclick={() => (ui.modal = 'gallery')}><Icon name="image" />What the 3D stage draws</button>
        <input type="file" accept=".gdtf,.qxf,.json" bind:this={fileInput} onchange={file} hidden />
      </div>
      {#if libErr}<p class="err">{libErr}</p>{/if}

      {#if query}
        <!-- found: the built-in ones first (nothing to download), then the libraries' -->
        {#if builtIn.length}
          <h3 class="mh">Built in <span class="faint">(no download)</span></h3>
          <div class="types builtin">{#each builtIn as t (t.id)}{@render typeCard(t)}{/each}</div>
        {/if}
        {#if results.length}
          <h3 class="mh">From the libraries <span class="faint">({results.length}{results.length === 48 ? '+' : ''} found; Open Fixture Library and QLC+)</span></h3>
          <div class="types results">{#each results as e (ek(e))}{@render libCard(e)}{/each}</div>
        {:else if all.length && !builtIn.length}
          <p class="muted none">Nothing found for "{query}". Not every fixture is in a library: <button onclick={() => (make = true)}>Make my own…</button> makes one from its manual's channel table.</p>
        {/if}
      {:else}
        <p class="hint">Not sure which it is? The channel table in the manual ("CH1 dimmer, CH2 red…") tells you. Or type its maker:</p>
        <div class="makers">{#each POPULAR_MAKERS as m (m)}<button class="sm" onclick={() => { q = m + ' '; searchBox?.focus(); }}>{m}</button>{/each}</div>
        {#if mine.length}
          <h3 class="mh">My fixtures <span class="faint">(made or imported before, kept in this browser)</span></h3>
          <div class="types mine">{#each mine as t (t.id)}{@render typeCard(t, true)}{/each}</div>
        {/if}
        <!-- (the usual lights first: dimmers, PARs, heads; the pixel rings and matrices after them) -->
        <h3 class="mh">{mine.length ? "Generic and this show's" : 'Generic lights'} <span class="faint">(PARs, dimmers, heads, bars, machines)</span></h3>
        <div class="types">{#each shownTypes as t (t.id)}{@render typeCard(t)}{/each}</div>
        <h3 class="mh">LED rings and matrices <span class="faint">(WS2812: one light with a shape)</span></h3>
        <div class="types shapes">{#each shapeTypes as t (t.id)}{@render typeCard(t)}{/each}</div>
      {/if}
      <p class="faint credit">Libraries: Open Fixture Library (MIT) and QLC+ (Apache 2.0). The previews are the 3D stage's own lights.</p>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions (Enter in any of its fields adds, as in a form) -->
    <div class="side" data-source={libType && typeId === libType.id && chosen ? chosen.source : undefined} onkeydown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && type) { e.preventDefault(); add(); } }}>
      {#if type}<div class="bigpv"><FixturePreview {type} {mode} hover /></div>{/if}
      <h2>{type ? typeLabel(type) : ''}</h2>
      {#if libType && typeId === libType.id && chosen?.alt}
        <p class="faint small2">Both libraries have this one; this is the {chosen.source === 'ofl' ? 'Open Fixture Library' : 'QLC+'} one{chosen.source === 'ofl' ? ' (usually more detailed)' : ''}.
          <button class="ghost link" onclick={() => choose(chosen!.alt!)}>Use the {chosen.alt.source === 'qlc' ? 'QLC+' : 'OFL'} definition instead</button></p>
      {/if}
      {#if type && type.modes.length > 1}
        <label>Mode <select bind:value={mode} aria-label="Mode">{#each type.modes as m (m.name)}<option value={m.name}>{m.name} ({m.channels.length} ch)</option>{/each}</select></label>
      {/if}
      {#if picked && type?.source !== 'generic'}
        <details class="chd" open={picked.channels.length <= 40}>
          <summary>Its {picked.channels.length} channels <span class="faint">(compare with the manual)</span></summary>
          <ol class="chs">{#each picked.channels as c, i (i)}{@const what = c.fine ? 'fine' : ATTR_LABEL[c.attr] ?? c.attr}<li><span class="n">{i + 1}</span>{c.name}{#if what.toLowerCase() !== c.name.toLowerCase()}<span class="faint">{what}</span>{/if}</li>{/each}</ol>
        </details>
      {/if}
      <label>How many <input type="number" min="1" max="96" bind:value={count} aria-label="How many" /></label>
      <label>Name <input bind:value={name} aria-label="Name" /></label>
      <label title="The universe number set on your LuxDMX output (most setups only use 0)">Universe <input type="number" min="0" max="32767" bind:value={universe} aria-label="Universe" /></label>
      {#if width > 512}
        <p class="faint">Too big for one universe, so each runs on over the next ones ({wideSpans} universes, whole pixels on each), from the first free ones at or after universe {universe}. Set your box's pixel port to the same universe.</p>
      {:else}
      <label>Start address <input type="number" min="1" max="512" bind:value={address} aria-label="Start address" placeholder={nextFree > 0 ? `next free: ${nextFree}` : 'universe full'} /></label>
      {#if address && address > 0 && address + count * width - 1 > 512}
        <!-- (a universe ends at 512: said before Add, with where they'd fit) -->
        <p class="err" role="status">{address} to {address + count * width - 1} runs past 512, the last channel of a universe. Start at {Math.max(1, 513 - count * width)} at most, or put them on universe {universe + 1}.
          <button class="ghost link" onclick={() => (address = Math.max(1, 513 - count * width))}>Start at {Math.max(1, 513 - count * width)}</button></p>
      {:else}
      <p class="faint">{address && address > 0 ? `${address} to ${address + count * width - 1}.` : nextFree > 0 ? `They get ${nextFree} to ${nextFree + count * width - 1}${universe ? ` on universe ${universe}` : ''}.` : `Universe ${universe} is full.`}
        {count} × {width} channels = {count * width}.</p>
      {/if}
      {/if}
      {#if overlaps.length}
        <p class="err" role="status">These would share channels with {overlaps.length > 4 ? `${overlaps.slice(0, 4).join(', ')} and ${overlaps.length - 4} more` : overlaps.join(', ')}.
          {#if nextFree > 0}<button class="ghost link" onclick={() => (address = nextFree)}>Use {nextFree}, the next free one</button>{/if}
          Or remove those lights first (they may be a template's).</p>
      {/if}
      {#if hasLooks}
        <label title="New lights are dark in the looks you have until you set them. Here they can do what one of your lights does in every look.">In the looks
          <select value={like} onchange={(e) => (likePick = (e.target as HTMLSelectElement).value)} aria-label="In the looks">
            <option value="">not yet (dark until you set them)</option>
            <!-- by how alike they are; the universe when the rig has more than one (the hall's bars vs the church's PARs) -->
            {#each LIKE_GROUPS as [label, lo, hi] (label)}
              {@const some = likes.filter((x) => x.s >= lo && x.s < hi)}
              {#if some.length}<optgroup {label}>{#each some as { f } (f.id)}<option value={f.id}>like {f.name}{manyUnis ? ` (universe ${f.universe})` : ''}</option>{/each}</optgroup>{/if}
            {/each}
          </select></label>
        <p class="faint small">{like ? 'They get its part in every look, its groups and effects.' : 'Your looks leave them dark until you set them.'}</p>
      {/if}
      {#if err}<p class="err">{err}</p>{/if}
      <!-- (a long name ends in … inside the button, the whole of it on hover) -->
      <button class="primary big" onclick={add} title="Add {count} × {name}" disabled={!type}><Icon name="plus" /><span class="what">Add {count} × {name}</span></button>
    </div>
  </div>
</Modal>
{/if}

<style>
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 1.1rem; }
  .main { min-width: 0; }
  .search { display: flex; align-items: center; gap: .5rem; padding: .15rem .7rem; border: 1px solid var(--line2); border-radius: var(--radius); background: var(--bg2); position: sticky; top: 0; z-index: 2; color: var(--muted); }
  .search:focus-within { border-color: var(--accent); }
  .search input { flex: 1; min-width: 0; border: 0; background: transparent; font-size: 1rem; padding: .55rem 0; outline: none; box-shadow: none; }
  .search .n { font-size: .8rem; color: var(--faint); white-space: nowrap; }
  .sources { margin: .55rem 0 .2rem; flex-wrap: wrap; gap: .35rem; }
  .hint { margin: .4rem 0 .2rem; font-size: .84rem; color: var(--muted); }
  .makers { display: flex; flex-wrap: wrap; gap: .3rem; }
  .makers .sm { padding: .25rem .65rem; font-size: .84rem; border-radius: 999px; }
  .mh { font-size: .84rem; margin: .9rem 0 .2rem; color: var(--text); font-weight: 600; }
  /* (one scroll for the whole list, the dialog's; the Add panel stays in view beside it) */
  .types { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: .55rem; margin-top: .4rem; }
  .tw { position: relative; display: grid; }
  .tcard { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; text-align: left; white-space: normal; padding: 0; gap: 0; overflow: hidden;
           border-radius: var(--radius); background: var(--panel2); min-height: 0; }
  .tcard:hover { border-color: var(--line2); }
  .tcard.cur { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .tcard.busy { opacity: .75; }
  .pvbox { position: relative; display: block; aspect-ratio: 16 / 10; background: #07090d; border-bottom: 1px solid var(--line); }
  .kind { position: absolute; left: .4rem; top: .35rem; font-size: .68rem; letter-spacing: .02em; padding: .05rem .4rem; border-radius: 999px; background: #000a; color: var(--muted); }
  .stand { position: absolute; right: .4rem; bottom: .35rem; font-size: .66rem; padding: .05rem .4rem; border-radius: 999px; background: #000a; color: var(--faint); }
  .tt { display: flex; flex-direction: column; gap: .15rem; padding: .45rem .55rem .2rem; flex: 1; }
  .tt b { font-size: .9rem; color: var(--text); line-height: 1.25; }
  .tt .faint { font-size: .78rem; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .man { font-size: .74rem; color: var(--muted); }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; padding: .2rem .55rem .5rem; }
  .foot .chip { font-size: .7rem; padding: 0 .35rem; }
  .chip.can { color: var(--cyan); border-color: color-mix(in srgb, var(--cyan) 30%, transparent); background: color-mix(in srgb, var(--cyan) 8%, transparent); }
  .dots { display: flex; gap: 2px; flex-wrap: wrap; margin-left: auto; }
  .dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid #0006; }
  .src { font-size: .7rem; border-radius: 4px; padding: 0 .3rem; }
  .src.ofl { background: #3a8ef333; color: #8ab8ff; } .src.qlc { background: #45d85c22; color: var(--green); }
  .forget { position: absolute; top: 4px; right: 4px; padding: .15rem; background: #000a; border-radius: 50%; }
  .none { margin: .8rem 0; }
  .credit { font-size: .74rem; margin: 1rem 0 0; }

  .side { display: flex; flex-direction: column; gap: .45rem; position: sticky; top: 0; align-self: start; }
  .side h2 { margin: .1rem 0 0; font-size: 1rem; }
  .bigpv { aspect-ratio: 16 / 10; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line2); background: #07090d; }
  .side label { display: flex; flex-direction: column; gap: .15rem; color: var(--muted); font-size: .85rem; }
  .big { padding: .6rem; max-width: 100%; min-width: 0; font-size: .95rem; }
  .big .what { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .chd summary { cursor: pointer; font-size: .84rem; color: var(--muted); }
  .chs { list-style: none; margin: .3rem 0 0; padding: 0; max-height: 26vh; overflow: auto; font-size: .8rem; }
  .chs li { display: flex; gap: .4rem; align-items: baseline; padding: .05rem 0; }
  .chs .n { width: 1.6rem; text-align: right; color: var(--faint); font-variant-numeric: tabular-nums; flex: none; }
  .chs .faint { margin-left: auto; font-size: .74rem; }
  .small2 { font-size: .8rem; margin: 0; }
  /* Phones: the settings and the Add button first, the types below. */
  @media (max-width: 760px) { .cols { grid-template-columns: 1fr; } .side { order: -1; position: static; } .bigpv { display: none; } .types { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); } }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 0; min-width: 0; }
  .small { font-size: .78rem; margin: -.25rem 0 0; }
  .err { color: var(--pink); }
</style>
