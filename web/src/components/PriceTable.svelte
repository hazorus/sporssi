<script>
  import { classify, userPrice, hhmm, fmtPrice } from '../lib/pricing.js';

  let { hours, settings, bands, nowMs, unit } = $props();
  const quarterMode = $derived(settings.resolution === 'quarter');

  function cell(spot) {
    return { v: userPrice(spot, settings), cls: classify(spot, bands) };
  }
  const isNow = (t, mins) => nowMs >= t && nowMs < t + mins * 60000;
</script>

<div class="scroll">
  <table>
    <thead>
      <tr>
        <th>Klo</th>
        {#if quarterMode}
          <th class="num">:00</th><th class="num">:15</th><th class="num">:30</th><th class="num">:45</th>
        {/if}
        <th class="num">{quarterMode ? 'Tunnin ka.' : 'Hinta'} ({unit})</th>
      </tr>
    </thead>
    <tbody>
      {#each hours as h (h.t)}
        {@const avg = cell(h.spot)}
        <tr class:now={!quarterMode && isNow(h.t, 60)}>
          <td>{hhmm(h.t)}–{hhmm(h.t + 3600000)}</td>
          {#if quarterMode}
            {#each h.quarters as q (q.t)}
              {@const c = cell(q.spot)}
              <td class="num" class:qnow={isNow(q.t, 15)}><span class="swatch c-{c.cls}"></span> {fmtPrice(c.v)}</td>
            {/each}
          {/if}
          <td class="num"><span class="swatch c-{avg.cls}"></span> <b>{fmtPrice(avg.v)}</b></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  td.qnow { outline: 2px solid var(--now); outline-offset: -2px; }
</style>
