<script lang="ts">
  // Adding lights: pick what kind (with a picture), how many, where. Generic types cover most cheap
  // gear; the library, a file or your own type cover the rest.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import Library from './Library.svelte';
  import FixtureEditor from './FixtureEditor.svelte';
  import { app } from '../app.svelte';
  import { spansOf } from '../model/pixelLayout';
  import PixelShapeMaker from './PixelShapeMaker.svelte';
  import { GENERIC, KIND_LABEL, caps, kindOf, modeOf, typeLabel } from '../model/library';
  import { importFixtureFile } from '../import/file';
  import { ui } from './ui.svelte';
  import type { FixtureType } from '../model/types';

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
  };
  let typeId = $state('gen-drgb');
  let count = $state(4), universe = $state(0), name = $state('PAR'), mode = $state('');
  let address = $state<number | null>(null);   // empty = next free
  let lib = $state(false), make = $state(false), shapeMaker = $state(false);
  let err = $state('');
  let fileInput = $state<HTMLInputElement>();
  const type = $derived(app.types.get(typeId) ?? app.myTypes.find((t) => t.id === typeId));
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
  function pick(id: string) {
    typeId = id;
    likePick = null;
    const t = app.types.get(id) ?? app.myTypes.find((x) => x.id === id);
    const k = kindOf(modeOf(t, ''));
    const c = caps(modeOf(t, ''));
    const haze = modeOf(t, '')?.channels.some((x) => x.attr === 'haze');
    name = t && t.source !== 'generic' ? t.model : k === 'mover' ? 'Head' : k === 'bar' ? 'Bar' : k === 'fog' ? (haze ? 'Hazer' : 'Fog') : k === 'sfx' ? typeLabel(t!).split(' ')[0] : k === 'strobe' ? 'Strobe'
      : k === 'dimmer' ? 'Dimmer' : !c.color && c.cct ? 'White' : 'PAR';
    // People own PARs in fours, heads in pairs, and one fog machine.
    count = k === 'fog' || k === 'sfx' || k === 'strobe' ? 1 : k === 'mover' ? 2 : k === 'bar' ? 2 : 4;
    // a ring or a matrix: one, called what it is
    const shape = modeOf(t, '')?.layout;
    if (shape) { count = 1; if (t?.source === 'generic') name = shape.kind === 'matrix' ? 'Matrix' : shape.rings.length > 1 ? 'Disc' : 'Ring'; }
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
    if (my && !app.show.fixtureTypes.some((t) => t.id === typeId)) app.addType(my);
    const before = app.show.fixtures.length;
    err = app.addFixtures(typeId, mode, Math.max(1, Math.min(96, count | 0)), Math.max(0, universe | 0), name.trim() || 'Fixture', address && address > 0 ? address : undefined);
    const n = app.show.fixtures.length - before;
    if (n) {
      app.selected = app.show.fixtures.slice(before).map((f) => f.id);
      const src = like ? app.show.fixtures.find((f) => f.id === like) : undefined;
      const cues = src ? app.playAlong(app.selected, src.id) : 0;
      ui.toast(cues ? `Added ${n} × ${name}. In your ${cues} look${cues === 1 ? '' : 's'} they do what ${src!.name} does (Ctrl+Z takes it back)` : `Added ${n} × ${name}`, 5000);
      onclose();
    }
  }
  async function file() {
    const f = fileInput?.files?.[0];
    if (fileInput) fileInput.value = '';
    if (!f) return;
    try { pick(app.addType(await importFixtureFile(f))); } catch (e) { err = (e as Error).message; }
  }
</script>

{#snippet typeCard(t: FixtureType)}
          {@const k = kindOf(modeOf(t, ''))}
          <button class="tcard" class:cur={t.id === typeId} onclick={() => pick(t.id)} title={KIND_LABEL[k]} data-type={t.id}>
            <span class="ti"><Icon name={k} size={22} /></span>
            <span class="tt"><b>{t.source === 'generic' ? t.model : typeLabel(t)}</b>
              <span class="faint">{BLURB[t.id] ?? shapeBlurb(t) ?? `${t.modes.length} mode${t.modes.length > 1 ? 's' : ''}, from ${t.source === 'ofl' ? 'the Open Fixture Library' : t.source === 'qxf' ? 'QLC+' : t.source === 'gdtf' ? 'GDTF' : t.source === 'generic' ? 'the built-in ones' : 'you'}`}</span></span>
            <span class="side2">
              <span class="chip">{modeOf(t, '')?.channels.length} ch</span>
              <span class="dots">{#each dots(t) as [c, title] (title)}<span class="dot" style="background:{c}" {title}></span>{/each}</span>
            </span>
          </button>
{/snippet}

{#if lib}<Library onclose={() => (lib = false)} onpick={(id, m) => { pick(id); if (m) mode = m; }} />
{:else if make}<FixtureEditor onclose={() => (make = false)} onsaved={pick} />
{:else if shapeMaker}<PixelShapeMaker onclose={() => (shapeMaker = false)} onsaved={pick} />
{:else}
<Modal title="Add fixtures" {onclose} wide>
  <div class="cols">
    <div>
      <div class="row src">
        <button onclick={() => (lib = true)}><Icon name="search" />Search 2400+ fixtures…</button>
        <button onclick={() => fileInput?.click()}><Icon name="upload" />GDTF / QLC+ / OFL file…</button>
        <button onclick={() => (make = true)}><Icon name="wizard" />Make my own…</button>
        <button onclick={() => (shapeMaker = true)}><Icon name="sun" />Ring or matrix…</button>
        <input type="file" accept=".gdtf,.qxf,.json" bind:this={fileInput} onchange={file} hidden />
      </div>
      <p class="hint">Not sure? Look at the channel table in the manual: "CH1 dimmer, CH2 red…" tells you which of these it is.</p>
      <h3 class="mh">LED rings and matrices <span class="faint">(WS2812: one light with a shape)</span></h3>
      <div class="types shapes">
        {#each shapeTypes as t (t.id)}{@render typeCard(t)}{/each}
      </div>
      {#if mine.length}
        <h3 class="mh">My fixtures <span class="faint">(made or imported before, kept in this browser)</span></h3>
        <div class="types mine">
          {#each mine as t (t.id)}
            {@const k = kindOf(modeOf(t, ''))}
            <div class="mywrap">
              <button class="tcard" class:cur={t.id === typeId} onclick={() => pick(t.id)} title={KIND_LABEL[k]} data-type={t.id}>
                <span class="ti"><Icon name={k} size={22} /></span>
                <span class="tt"><b>{typeLabel(t)}</b><span class="faint">{t.modes.length} mode{t.modes.length > 1 ? 's' : ''}</span></span>
                <span class="side2"><span class="chip">{modeOf(t, '')?.channels.length} ch</span>
                  <span class="dots">{#each dots(t) as [c, title] (title)}<span class="dot" style="background:{c}" {title}></span>{/each}</span></span>
              </button>
              <button class="ghost forget" title="Forget it in this browser (shows that use it keep their copy)" aria-label="Forget {typeLabel(t)}" onclick={() => app.forgetMyType(t.id)}><Icon name="close" size={12} /></button>
            </div>
          {/each}
        </div>
      {/if}
      <h3 class="mh">{mine.length ? "Generic and this show's" : 'Everything else'}</h3>
      <div class="types">
        {#each shownTypes as t (t.id)}{@render typeCard(t)}{/each}
      </div>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions (Enter in any of its fields adds, as in a form) -->
    <div class="side" onkeydown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && type) { e.preventDefault(); add(); } }}>
      <h2>{type ? typeLabel(type) : ''}</h2>
      {#if type && type.modes.length > 1}
        <label>Mode <select bind:value={mode} aria-label="Mode">{#each type.modes as m (m.name)}<option value={m.name}>{m.name} ({m.channels.length} ch)</option>{/each}</select></label>
      {/if}
      <label>How many <input type="number" min="1" max="96" bind:value={count} aria-label="How many" /></label>
      <label>Name <input bind:value={name} aria-label="Name" /></label>
      <label title="The universe number set on your LuxDMX output (most setups only use 0)">Universe <input type="number" min="0" max="32767" bind:value={universe} aria-label="Universe" /></label>
      {#if width > 512}
        <p class="faint">Too big for one universe, so each runs on over the next ones ({wideSpans} universes, whole pixels on each), from the first free ones at or after universe {universe}. Set your box's pixel port to the same universe.</p>
      {:else}
      <label>Start address <input type="number" min="1" max="512" bind:value={address} aria-label="Start address" placeholder={nextFree > 0 ? `next free: ${nextFree}` : 'universe full'} /></label>
      <p class="faint">{address && address > 0 ? `${address} to ${address + count * width - 1}.` : nextFree > 0 ? `They get ${nextFree} to ${nextFree + count * width - 1}${universe ? ` on universe ${universe}` : ''}.` : `Universe ${universe} is full.`}
        {count} × {width} channels = {count * width}.</p>
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
      <button class="primary big" onclick={add}><Icon name="plus" />Add {count} × {name}</button>
    </div>
  </div>
</Modal>
{/if}

<style>
  .cols { display: grid; grid-template-columns: 1fr 240px; gap: 1rem; }
  .src { margin-bottom: .4rem; }
  .types { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: .4rem; margin-top: .4rem; max-height: 58vh; overflow: auto; }
  .tcard { justify-content: flex-start; text-align: left; white-space: normal; padding: .45rem .5rem; gap: .5rem; align-items: flex-start; }
  .tcard.cur { border-color: var(--accent); background: #ffaa1c12; }
  .ti { color: var(--accent); margin-top: .1rem; }
  .tt { display: flex; flex-direction: column; flex: 1; }
  .side { display: flex; flex-direction: column; gap: .45rem; }
  .side label { display: flex; flex-direction: column; gap: .15rem; color: var(--muted); font-size: .85rem; }
  .big { padding: .55rem; }
  .mh { font-size: .8rem; margin: .6rem 0 .1rem; color: var(--text); font-weight: 600; }
  .types.mine { max-height: 22vh; }
  .types.shapes { max-height: none; overflow: visible; }
  .mywrap { position: relative; display: grid; }
  .forget { position: absolute; top: 2px; right: 2px; padding: .1rem; }
  .side2 { display: flex; flex-direction: column; align-items: flex-end; gap: .3rem; }
  .dots { display: flex; gap: 2px; flex-wrap: wrap; justify-content: flex-end; max-width: 60px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid #0006; }
  /* Phones: the settings and the Add button first, the types below. */
  @media (max-width: 760px) { .cols { grid-template-columns: 1fr; } .side { order: -1; } .types { max-height: 46vh; } }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 0; min-width: 0; }
  .small { font-size: .78rem; margin: -.25rem 0 0; }
</style>
