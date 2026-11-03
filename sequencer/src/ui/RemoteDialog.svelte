<script lang="ts">
  // Phone as a remote: switch it on, and a phone scans the code (or opens the box's /remote and
  // types the four digits). The phone plays this show's live pages through the box; see
  // remote/host.svelte.ts for what it can do and how held buttons stay safe.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import qrcode from 'qrcode-generator';
  import { app } from '../app.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const r = app.remote;
  const live = $derived((void app.bridgeRev, app.bridges.filter((b) => b.state === 'ready')));
  let pick = $state('');
  const box = $derived(live.find((b) => b.host === pick) ?? live[0]);
  // the box's own IP when it said it: a phone often can't resolve a .local name (an address with a
  // port of its own was typed on purpose, and stays)
  const where = $derived(!box ? '' : box.host.includes(':') ? box.host : box.ip || box.host);
  const url = $derived(where ? `http://${where}/remote#k=${r.code}` : '');
  const qr = $derived.by(() => {
    if (!url || !r.on) return '';
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  });
  // once a phone is on, the code folds away (a guest at the laptop shouldn't find it on screen)
  let showCode = $state(r.phones === 0);
  let before = r.phones;
  $effect(() => {
    const n = r.phones;
    if (n > 0 && before === 0) showCode = false;     // the first phone is in: fold the code away
    if (n === 0) showCode = true;
    before = n;
  });
  let host = $state('');
  // locked for the service: it only shows (no switching off, no new code, no taking phones off,
  // no code for a curious guest to read off the screen)
  const ro = $derived(app.locked);
  const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
</script>

<Modal title="Phone as a remote" {onclose}>
  <div class="rm">
    {#if ro}
      <p>{r.on ? `${r.phones} phone${r.phones === 1 ? '' : 's'} connected.` : 'The phone remote is off.'} Locked for the show: unlock to change this.</p>
    {:else if !box}
      <p>The phone talks to this computer through your LuxDMX, so connect it first.</p>
      {#each app.bridges as b (b.host)}
        <div class="row"><Icon name="link" /> <span class="grow">{b.name || b.host}</span><button class="primary" onclick={() => b.open()}>Connect</button></div>
      {:else}
        <form class="row" onsubmit={(e) => { e.preventDefault(); if (host.trim()) { app.addDevice(host.trim()); host = ''; } }}>
          <input bind:value={host} placeholder="its address, e.g. 192.168.1.50" aria-label="LuxDMX address" class="grow" />
          <button class="primary">Add your LuxDMX</button>
        </form>
      {/each}
      {#if r.on}<button class="ghost" onclick={() => r.stop()}>Switch the remote off</button>{/if}
    {:else if !r.on}
      <p>A phone on the box's network plays this show's live pages: its buttons, faders, GO and Blackout. It can't edit anything.</p>
      <button class="primary big" onclick={() => r.start()}><Icon name="phone" size={20} />Switch the phone remote on</button>
    {:else}
      {#if showCode}
        <div class="pair">
          <div class="qr" role="img" aria-label="QR code for {url}">{@html qr}</div>
          <div class="how">
            <p>Scan it with the phone's camera. Or open <span class="mono">http://{where}/remote</span> on the phone and type</p>
            <p class="code" aria-label="Code {r.code.split('').join(' ')}">{r.code}</p>
            <p class="faint small">The phone has to be on the same network as the box.</p>
          </div>
        </div>
        {#if live.length > 1}
          <label class="row">Through <select bind:value={pick} aria-label="Which LuxDMX the phone opens">{#each live as b (b.host)}<option value={b.host}>{b.name || b.host}</option>{/each}</select></label>
        {/if}
      {:else}
        <button class="ghost" onclick={() => (showCode = true)}>Show the code again</button>
      {/if}
      <div class="phones" role="status">
        {#each r.list as p (p.rid)}
          <div class="ph"><Icon name="phone" /><span class="grow"><b>{p.dev}</b> <span class="faint">joined {ago(p.since)}{p.last ? ` · last: ${p.last}` : ''}</span></span>
            <button class="ghost sm" onclick={() => r.remove(p.rid)} title="Take this phone off the remote (it lets go of whatever it holds)">Remove</button></div>
        {:else}
          <p class="faint"><Icon name="phone" /> No phone yet</p>
        {/each}
      </div>
      <label class="row keep" title="For a phone that comes back every week: the remote is on again after the tablet or browser restarts, with the same code">
        <input type="checkbox" checked={r.keep} onchange={(e) => r.setKeep((e.target as HTMLInputElement).checked)} />
        Keep it on with this code (after a restart too)</label>
      <div class="row end">
        <button class="ghost" onclick={() => r.newCode()} title="Every phone is out; they join again with the new code">New code</button>
        <button onclick={() => r.stop()}>Switch off</button>
      </div>
      <p class="faint small">A phone that locks or loses the Wi-Fi lets go of whatever it was holding (flash, fog, blinder) within a second and a half; its page keeps the screen on while it plays.
        The code keeps a stray phone out by accident; anyone on the box's network could send it DMX anyway.</p>
    {/if}
  </div>
</Modal>

<style>
  .rm { display: flex; flex-direction: column; gap: .8rem; width: min(540px, 100%); }
  .rm p { margin: 0; }
  .big { min-height: 48px; font-size: 1rem; justify-content: center; gap: .5rem; }
  .pair { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .qr { width: 176px; height: 176px; background: #fff; border-radius: 10px; padding: 6px; flex: none; }
  .qr :global(svg) { width: 100%; height: 100%; display: block; }
  .how { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: .4rem; }
  .code { font: 800 2.4rem/1 ui-monospace, monospace; letter-spacing: .35em; color: var(--orange); }
  .mono { font-family: ui-monospace, monospace; white-space: nowrap; color: var(--text); }
  .phones { display: flex; flex-direction: column; gap: .35rem; }
  .ph { display: flex; align-items: center; gap: .5rem; padding: .45rem .6rem; border: 1px solid var(--line); border-radius: var(--radius-s); background: var(--panel2); }
  .small { font-size: .8rem; }
  .grow { flex: 1; min-width: 0; }
  .end { justify-content: flex-end; gap: .5rem; }
  form.row { gap: .5rem; }
</style>
