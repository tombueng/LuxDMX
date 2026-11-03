<script lang="ts">
  // The LuxDMX boxes this show plays on. Each one is a pill with its state; Connect opens the box's
  // bridge page (a popup, because only a page from the box itself may talk to it). + adds a box.
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { rig } from '../rdm/rig.svelte';
  import { dismiss, ui } from './ui.svelte';
  import { LINK, type LinkOutput, type LinkFile, type LinkManifest, type Computer, linkManifest, thisComputer, downloadsFor, OS_NAME, archName, FIRST_RUN } from '../output/link';

  let host = $state('');
  // while the rig is watched: how many lights to look at (not answering, a problem, a status message)
  const rigAlert = $derived(rig.watching ? rig.goneList.length + rig.check.issues || '' : '');
  let open = $state(false);
  const label: Record<string, string> = {
    closed: 'not connected', opening: 'opening…', asking: 'allow it in the popup', ready: 'connected',
    denied: 'denied', blocked: 'popup blocked', silent: 'no answer', reconnecting: 'reconnecting…',
  };
  const hint: Record<string, string> = {
    silent: 'The box did not answer. Check the address (the one you open its web page with) and that its firmware is new enough to have the sequencer bridge (update it from its web page).',
    blocked: 'The browser blocked the popup: allow popups for this page, then Connect again.',
    denied: 'The box\'s popup said no. Connect again and choose Allow.',
  };
  const linkHint = 'LuxDMX Link isn\'t running on this computer. Get Link offers the download; once it runs, the app finds it by itself.';
  // Chrome on a page from the internet asks before it may reach this computer (Local Network
  // Access). Said no, Link can't be reached even when it runs: the pill says so, not "not running".
  const linkBlocked = 'The browser blocks this page from reaching programs on this computer, so it can\'t find LuxDMX Link. Allow access to the local network in the site settings (the icon left of the address).';
  const linkAccess = $derived((void app.bridgeRev, (app.bridges.find((b) => b.host === LINK) as LinkOutput | undefined)?.access ?? ''));
  // (the app from the internet, not this computer or the LAN: the browser may ask first)
  const publicPage = typeof location !== 'undefined' && !!location.hostname && !/^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  const isLink = (b: { host: string }) => b.host === LINK;
  const hasLink = $derived((void app.bridgeRev, app.bridges.some(isLink)));
  const linkDev = () => app.bridges.find(isLink);
  function addLink() {
    app.addDevice(LINK); open = false;
    // not running (it would be connected in a blink): offer it
    setTimeout(() => { if (linkDev() && linkDev()?.state !== 'ready') openGet(); }, 1200);
  }

  // "Get LuxDMX Link": the file for this computer (the others folded away), the first-run steps,
  // and it closes by itself once Link answers.
  let getOpen = $state(false);
  let offer = $state<{ m: LinkManifest | null; c: Computer; mine: LinkFile[]; others: LinkFile[] } | null>(null);
  let takeFocus = false;
  // asked (Get Link), or opened by itself while the focus is nowhere (the add form just closed);
  // never pulls the focus away from something the person went on to
  async function openGet(asked = false) {
    takeFocus = asked || !document.activeElement || document.activeElement === document.body;
    getOpen = true;
    if (compact && !list) toggleList();
    const [m, c] = await Promise.all([linkManifest(), thisComputer()]);
    offer = { m, c, ...(m ? downloadsFor(m, c) : { mine: [], others: [] }) };
  }
  $effect(() => {
    void app.bridgeRev;
    if (getOpen && linkDev()?.state === 'ready') { getOpen = false; ui.toast('LuxDMX Link found: connected'); }
  });
  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
  // (the panel takes the focus once its files are there: the next thing to do is the download)
  const focusFirst = (node: HTMLElement, on: boolean) => { if (on && takeFocus) queueMicrotask(() => node.focus()); };
  // added: the focus goes on to its Connect (the next thing to do)
  function add(e: Event) {
    e.preventDefault(); const h = host.trim(); app.addDevice(host); host = ''; open = false;
    setTimeout(() => document.querySelector<HTMLElement>(`[data-box="${CSS.escape(h)}"] button.primary`)?.focus(), 0);
  }
  // (autofocus doesn't fire for a field that comes in later)
  const focusIt = (node: HTMLInputElement, on: boolean) => { if (on) queueMicrotask(() => node.focus()); };
  // On phones and tablets the boxes fold into one button with a status dot; the pills open under it.
  let w = $state(typeof window === 'undefined' ? 1200 : window.innerWidth);
  // One button with a status dot on a tablet, and on a wider screen too when the boxes' pills don't
  // fit on the top bar's row (they'd wrap it to two rows, and every panel loses that height): the
  // width at which they didn't is kept, so it doesn't flip back and forth (more boxes look again)
  let wrapAt = $state(0), devEl = $state<HTMLDivElement>();
  const compact = $derived(w <= 1100 || w <= wrapAt);
  $effect(() => {
    void app.bridges.length; void w;
    if (compact || !devEl) return;
    const el = devEl;
    requestAnimationFrame(() => { const top = el.closest('.top'); if (top && el.isConnected && el.getBoundingClientRect().top - top.getBoundingClientRect().top > 24) wrapAt = w; });
  });
  let lastCount = 0;
  $effect(() => { const n = app.bridges.length; if (n !== lastCount) { lastCount = n; wrapAt = 0; } });
  let list = $state(false);
  // the list opens to the left of its button, or to the right where there's no room (a top bar that
  // wrapped puts the button near the left edge)
  let boxesBtn = $state<HTMLButtonElement>();
  let listRight = $state(false);
  function toggleList() {
    const r = boxesBtn?.getBoundingClientRect();
    listRight = !!r && r.right < Math.min(360, window.innerWidth - 16) + 8;
    list = !list;
  }
  const overall = $derived.by(() => {
    void app.bridgeRev;
    const st = app.bridges.map((b) => b.state);
    // green only when every box is connected; a problem anywhere wins; some connected = orange
    return !st.length ? 'none' : st.every((s) => s === 'ready') ? 'ready' : st.some((s) => s === 'denied' || s === 'blocked' || s === 'silent') ? 'denied'
      : st.some((s) => s === 'asking' || s === 'opening' || s === 'ready' || s === 'reconnecting') ? 'asking' : 'closed';
  });
  // what a pill shows of a box, read now (`_rev`: called again whenever a box changed)
  function view(b: (typeof app.bridges)[number], _rev: number) {
    const l = isLink(b) ? (b as LinkOutput) : undefined;
    return { state: b.state, name: b.name, fps: b.fps, outputs: b.outputs, link: !!l, version: l?.version ?? '', nodes: l?.nodes ?? [], proto: l?.proto, access: l?.access ?? '', alarmed: app.alarmed(b) };
  }
</script>

<svelte:window bind:innerWidth={w} />

{#snippet pills()}
  <!-- (a box isn't reactive itself: `bridgeRev` counts its changes. Each pill reads a snapshot made
       with it, so a change updates the pill in place: an open "Send as" stays open) -->
  {#each app.bridges as b (b.host)}
    {@const v = view(b, app.bridgeRev)}
    <span class="dev {v.state}" data-box={b.host} title={v.link ? (v.state === 'ready' ? `LuxDMX Link ${v.version}: ${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'} found (${v.nodes.map((n) => `${n.short || n.ip}: ${(n.universes ?? []).join(', ') || 'no outputs'}`).join('; ') || 'none answers ArtPoll: sends to everyone'})` : v.access === 'denied' ? linkBlocked : linkHint)
      : v.state === 'ready' ? `${b.host}: ${v.fps} frames/s now (a still look only sends a heartbeat). Outputs universe ${v.outputs.filter((o) => o.en).map((o) => o.uni).join(', ')}` : hint[v.state] ?? b.host}>
      <span class="dot"></span>
      <b>{v.name || b.host}</b>
      <span class="st">{v.link && v.state === 'silent' ? (v.access === 'denied' ? 'blocked by the browser' : 'not running') : v.link && v.state === 'ready' ? `connected · ${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'}` : label[v.state]}</span>
      {#if v.link && v.state === 'ready' && !app.locked}
        <select class="proto" value={v.proto} aria-label="Send as" onchange={(e) => app.setLinkProto((e.target as HTMLSelectElement).value as 'artnet' | 'sacn' | 'both')}>
          <option value="artnet">Art-Net</option><option value="sacn">sACN</option><option value="both">both</option></select>
      {/if}
      {#if v.state !== 'ready' && v.state !== 'reconnecting' && !v.alarmed && !v.link}<button class="primary sm" onclick={() => b.open()}>Connect</button>{/if}
      {#if v.link && v.state !== 'ready' && !app.locked}<button class="primary sm" data-popover-toggle aria-expanded={getOpen} onclick={() => (getOpen ? (getOpen = false) : openGet(true))}>Get Link</button>{/if}
      {#if !app.locked}<button class="ghost x" title="Remove this box from the show" aria-label="Remove {b.host}" onclick={() => app.removeDevice(b.host)}><Icon name="close" size={12} /></button>{/if}
    </span>
  {/each}
{/snippet}

{#snippet getPanel()}
  <div class="pop get" class:inline={compact} role="dialog" aria-label="Get LuxDMX Link" use:dismiss={() => (getOpen = false)}>
    <h2 class="title">Get LuxDMX Link</h2>
    <p class="hint">A small helper that sends Art-Net and sACN from this computer (a browser can't). Run it once: it installs itself just for you (no admin), starts when you log in, and this page finds it.</p>
    {#if linkAccess === 'denied'}
      <p class="blocked" role="alert" data-testid="link-blocked">Already running it? This browser blocks the page from reaching programs on this computer. Allow access to the local network in the site settings (the icon left of the address); the page finds Link by itself then.</p>
    {:else if publicPage}
      <p class="faint" data-testid="link-ask">Already running it? When the browser asks whether this site may reach devices on your local network, choose Allow.</p>
    {/if}
    {#if !offer}
      <p class="faint">Looking up the downloads…</p>
    {:else if !offer.m}
      <p class="hint">The downloads aren't on this copy of the app. Build LuxDMX Link from <code>link/</code> in the LuxDMX repo (one small file per system).</p>
    {:else}
      {#if offer.mine.length}
        <div class="dls">
          {#each offer.mine as f, i (f.file)}
            <a class="dl" href="./link/{f.file}" download use:focusFirst={i === 0}>
              Download for {OS_NAME[f.os]}{#if offer.mine.length > 1 || f.arch === 'arm64'}&nbsp;({archName(f)}){/if}<small>{mb(f.size)}</small></a>
          {/each}
        </div>
        <p class="hint">{FIRST_RUN[offer.mine[0].os]}</p>
        {#if offer.mine.length > 1 && offer.mine[0].os === 'macos'}<p class="faint">Not sure which Mac? Apple menu, About This Mac: "Chip" is Apple, "Processor" is Intel.</p>{/if}
      {:else}
        <p class="hint">LuxDMX Link runs on a Windows, Mac or Linux computer: open this page there to get it.</p>
      {/if}
      <details>
        <summary>Other systems</summary>
        <ul>
          {#each offer.others as f (f.file)}<li><a href="./link/{f.file}" download>{OS_NAME[f.os]}, {archName(f)}</a> <span class="faint">{mb(f.size)}</span></li>{/each}
        </ul>
        <p class="faint">First run: {OS_NAME.windows}, More info, Run anyway. {OS_NAME.macos}, right-click, Open. {OS_NAME.linux}, make it executable.</p>
      </details>
      <p class="faint">Version {offer.m.version}. It isn't signed by Apple or Microsoft yet, which is why your system asks once.</p>
    {/if}
    <p class="wait"><span class="dot"></span>Waiting for LuxDMX Link on this computer…</p>
  </div>
{/snippet}

{#snippet addForm()}
  <form class="pop" class:inline={compact} onsubmit={add} use:dismiss={() => (open = false)}>
    <p class="faint">The address of your LuxDMX, as you'd open its web page. Its outputs decide which universes it plays.</p>
    <!-- focused, but not in the phone list: it would pop the keyboard up every time -->
    <input placeholder="LuxDMX address, e.g. 192.168.1.50" bind:value={host} use:focusIt={!compact} aria-label="LuxDMX address" />
    <button type="submit" class="primary" disabled={!host.trim()}>Add LuxDMX</button>
    <!-- any Art-Net or sACN node, through LuxDMX Link on this computer -->
    {#if !hasLink}<button type="button" class="ghost" onclick={addLink} title="Any Art-Net or sACN node on the network, through LuxDMX Link on this computer">Art-Net / sACN from this computer</button>{/if}
  </form>
{/snippet}

{#if compact}
  <span class="wrap">
    <button class="ghost boxes {overall}" class:on={list} bind:this={boxesBtn} onclick={toggleList} aria-expanded={list} data-popover-toggle
            title="Your LuxDMX boxes" aria-label="LuxDMX boxes: {overall === 'none' ? 'none yet' : overall === 'ready' ? 'connected' : overall === 'denied' ? 'a problem' : overall === 'asking' ? 'not all connected' : 'not connected'}">
      <Icon name="link" size={18} /><span class="dot badge"></span>
    </button>
    {#if list}
      <div class="pop list" class:right={listRight} use:dismiss={() => (list = false)}>
        {@render pills()}
        {#if getOpen && hasLink}{@render getPanel()}{/if}
        {#if !app.bridges.length}<p class="faint">No LuxDMX in this show yet. The app works without one; add your box to light the room.</p>{/if}
        {#if app.bridges.length}<button class="ghost rigbtn" onclick={() => { list = false; ui.modal = 'rig'; }}><Icon name="search" />The rig (RDM)…{#if rigAlert}<span class="alert">{rigAlert}</span>{/if}</button>{/if}
        {#if !app.locked}{@render addForm()}{/if}
      </div>
    {/if}
  </span>
{:else}

<div class="devices" bind:this={devEl}>
  {@render pills()}
  {#if app.bridges.length}<button class="ghost rigbtn" onclick={() => (ui.modal = 'rig')} title="The rig with RDM: find the real lights, check them against the patch, watch them"><Icon name="search" />Rig{#if rigAlert}<span class="alert">{rigAlert}</span>{/if}</button>{/if}
  {#if getOpen && hasLink}{@render getPanel()}{/if}
  {#if !app.locked}
  <span class="wrap">
    <button class="ghost" class:on={open} onclick={() => (open = !open)} title="Add a LuxDMX" aria-label="Add a LuxDMX" aria-expanded={open} data-popover-toggle>
      <Icon name="plus" />{#if !app.bridges.length}<span>LuxDMX</span>{/if}</button>
    {#if open}{@render addForm()}{/if}
  </span>
  {/if}
</div>
{/if}

<style>
  .devices { display: flex; gap: .35rem; align-items: center; flex-wrap: wrap; }
  .dev { display: inline-flex; align-items: center; gap: .35rem; border: 1px solid var(--line); border-radius: 999px; padding: .12rem .2rem .12rem .55rem; font-size: .85rem; background: var(--panel); }
  .dot { width: .55rem; height: .55rem; border-radius: 50%; background: var(--muted); }
  .ready .dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .asking .dot, .opening .dot { background: var(--orange); animation: blink 1s infinite; }
  .denied .dot, .blocked .dot, .silent .dot { background: var(--pink); }
  .st { color: var(--muted); font-size: .78rem; }
  .ready .st { color: var(--green); }
  .sm { padding: .05rem .5rem; font-size: .8rem; }
  .x { padding: .15rem; }
  .wrap { position: relative; }
  .rigbtn { display: inline-flex; gap: .3rem; align-items: center; font-size: .85rem; position: relative; }
  .rigbtn .alert { min-width: 1.1rem; padding: 0 .3rem; border-radius: 999px; background: var(--pink); color: #fff; font-size: .7rem; font-weight: 700; text-align: center; }
  .pop { position: absolute; right: 0; top: 2.2rem; z-index: 60; width: 300px; display: flex; flex-direction: column; gap: .4rem; padding: .7rem; background: var(--panel2); border: 1px solid var(--line2); border-radius: var(--radius); box-shadow: var(--shadow); }
  .boxes { gap: .25rem; padding: .3rem .45rem; position: relative; }
  @media (pointer: coarse) { .boxes { min-height: 44px; min-width: 44px; justify-content: center; } }
  .boxes .badge { position: absolute; right: 5px; top: 5px; width: 8px; height: 8px; border: 1.5px solid var(--bg2); }
  .boxes .dot { background: var(--muted); }
  .boxes.ready .dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .boxes.asking .dot { background: var(--orange); animation: blink 1s infinite; }
  .boxes.denied .dot { background: var(--pink); }
  .proto { font-size: .75rem; min-height: 0; padding: 0 .2rem; }
  .pop.list { position: absolute; right: 0; top: 2.6rem; width: min(360px, calc(100vw - 1rem)); }
  .pop.list.right { right: auto; left: 0; }
  /* never past the bottom of the window (400 % zoom): it scrolls inside */
  .pop:not(.inline) { max-height: calc(100vh - 4rem); overflow: auto; }
  @media (max-width: 760px) { .pop.list { position: fixed; left: .5rem; right: .5rem; top: 3.2rem; width: auto; } }
  .pop.list .dev { justify-content: flex-start; }
  .pop.list .dev b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pop.inline { position: static; width: auto; padding: 0; border: 0; box-shadow: none; background: none; }
  .devices { position: relative; }
  .pop.get { width: 360px; top: 2.4rem; gap: .5rem; }
  .pop.get.inline { width: auto; padding: .5rem 0 0; border-top: 1px solid var(--line); border-radius: 0; }
  .get .title { margin: 0; font-size: 1rem; text-transform: none; letter-spacing: 0; color: var(--text); }
  .get p { margin: 0; }
  .get .blocked { padding: .45rem .6rem; border-radius: var(--radius-s); border: 1px solid color-mix(in srgb, var(--pink) 55%, transparent); background: color-mix(in srgb, var(--pink) 12%, transparent); font-size: .86rem; }
  .dls { display: flex; flex-direction: column; gap: .35rem; }
  .dl { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .5rem .7rem; border-radius: var(--radius-s); background: var(--green); color: #07150b; font-weight: 650; text-decoration: none; min-height: 44px; }
  .dl:hover { background: #5be070; }
  .dl:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .dl small { font-weight: 500; opacity: .75; white-space: nowrap; }
  .get details summary { cursor: pointer; color: var(--muted); font-size: .86rem; }
  .get ul { margin: .3rem 0; padding-left: 1.1rem; font-size: .86rem; line-height: 1.7; }
  .get a:not(.dl) { color: #8ab8ff; }
  .get code { font-size: .8rem; }
  .wait { display: flex; align-items: center; gap: .4rem; color: var(--muted); font-size: .8rem; border-top: 1px solid var(--line); padding-top: .45rem; }
  .wait .dot { background: var(--orange); animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: .35; } }
</style>
