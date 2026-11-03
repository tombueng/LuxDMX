<script lang="ts">
  // The DIP switches for a DMX address, the way cheap fixtures set it: switch n is worth 2^(n-1),
  // the address is the sum of the ones that are ON (knob up). Switch 10 is worth 512: only address
  // 512 uses it (on many fixtures it's a mode switch otherwise). With `onchange`, clicking a switch
  // flips it: set the address the way it's set on the fixture.
  let { address, onchange }: { address: number; onchange?: (address: number) => void } = $props();
  // 512 needs the 10th switch (worth 512); below that it stays off
  const on = $derived(Array.from({ length: 10 }, (_, i) => ((address >> i) & 1) === 1));
  const which = $derived(on.map((x, i) => (x ? i + 1 : 0)).filter(Boolean));
  function flip(i: number) {
    const a = address ^ (1 << i);
    if (a >= 1 && a <= 512) onchange?.(a);
  }
</script>

<div class="dip">
  <div class="row" role={onchange ? 'group' : 'img'} aria-label="DIP switches for address {address}: {which.length ? `switches ${which.join(', ')} on` : 'all off'}">
    {#each on as x, i (i)}
      {#if onchange && (i < 9 || address === 512)}
        <button class="sw" class:on={x} onclick={() => flip(i)} aria-pressed={x} aria-label="Switch {i + 1} ({2 ** i})" title="Switch {i + 1}: worth {2 ** i}"><span class="knob"></span><span class="n">{i + 1}</span></button>
      {:else}
        <span class="sw" class:on={x} class:extra={i === 9 && !x} title={i === 9 ? 'Switch 10 is only for address 512' : undefined}><span class="knob"></span><span class="n">{i + 1}</span></span>
      {/if}
    {/each}
  </div>
  <span class="faint sum">{which.length ? `Switch${which.length > 1 ? 'es' : ''} ${which.join(', ')} on (${which.map((n) => 2 ** (n - 1)).join(' + ')}) = ${address}` : 'All off'}</span>
</div>

<style>
  .dip { display: inline-flex; flex-direction: column; gap: .2rem; }
  .row { display: inline-flex; gap: 3px; padding: 3px; background: #b3261e; border-radius: 4px; margin-bottom: 15px; }
  .sw { width: 15px; height: 28px; min-width: 0; min-height: 0; padding: 0; border: 0; background: #f3f0e8; border-radius: 2px; position: relative; display: flex; justify-content: center; }
  button.sw { cursor: pointer; }
  button.sw:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  /* switch 10, unused below 512: greyed, but its number stays readable */
  .sw.extra { background: #a9a59d; } .sw.extra .knob { opacity: .55; }
  .knob { position: absolute; left: 2px; right: 2px; height: 10px; bottom: 2px; background: #2b2b2b; border-radius: 1px; transition: bottom .12s; }
  .sw.on .knob { bottom: 16px; }
  .n { position: absolute; bottom: -16px; font-size: .76rem; color: var(--muted); }
  .sum { font-size: .78rem; font-variant-numeric: tabular-nums; }
  @media (pointer: coarse) { .sw { width: 22px; height: 36px; } .sw.on .knob { bottom: 22px; } .knob { height: 12px; } }
</style>
