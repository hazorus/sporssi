<script>
  import { schedule, scheduleToHours } from '../lib/cost.js';
  import { hhmm, fmtEur, fmtKwh, fmtPrice } from '../lib/pricing.js';

  let { daySlots, devices, extra = [], priceAt, resolution, nowMs, unit } = $props();

  const result = $derived(schedule(daySlots, devices, priceAt, extra));
  const rows = $derived(resolution === 'quarter' ? result.rows : scheduleToHours(result.rows));
  const step = $derived(resolution === 'quarter' ? 15 : 60);
  const cols = $derived([
    ...devices.map((d) => ({ key: d.key, name: d.dev.name })),
    ...extra.map((x) => ({ key: x.key, name: x.name })),
  ]);
  const grand = $derived.by(() => {
    let kwh = 0, eur = 0, unknown = false;
    for (const t of Object.values(result.totals)) {
      kwh += t.kwh; eur += t.eur; unknown ||= t.unknown;
    }
    return { kwh, eur, unknown };
  });
  let hideEmpty = $state(false);
  const shown = $derived(hideEmpty ? rows.filter((r) => r.total.kwh > 1e-9) : rows);
</script>

{#if cols.length === 0}
  <p class="muted">Valitse laitteita tai ota lämmitys mukaan, niin taulukko näyttää kulutuksen ja kustannukset {resolution === 'quarter' ? 'varteittain' : 'tunneittain'}.</p>
{:else}
  <label class="small"><input type="checkbox" bind:checked={hideEmpty} /> Piilota rivit, joilla ei kulutusta</label>
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th rowspan="2">Klo</th>
          <th rowspan="2" class="num">Hinta<br />{unit}</th>
          {#each cols as c (c.key)}<th colspan="2" class="dev">{c.name}</th>{/each}
          <th colspan="2" class="dev">Yhteensä</th>
        </tr>
        <tr>
          {#each cols as c (c.key)}<th class="num">kWh</th><th class="num">€</th>{/each}
          <th class="num">kWh</th><th class="num">€</th>
        </tr>
      </thead>
      <tbody>
        {#each shown as r (r.t)}
          <tr class:now={nowMs >= r.t && nowMs < r.t + step * 60000}>
            <td>{hhmm(r.t)}</td>
            <td class="num">{fmtPrice(r.price)}</td>
            {#each cols as c (c.key)}
              {@const cell = r.cells[c.key]}
              {#if cell && cell.kwh}
                <td class="num">{fmtKwh(cell.kwh)}</td><td class="num">{fmtEur(cell.eur)}</td>
              {:else if cell && cell.kwh === null}
                <td class="num muted">?</td><td class="num muted">?</td>
              {:else}
                <td class="num muted"></td><td class="num muted"></td>
              {/if}
            {/each}
            <td class="num"><b>{r.total.kwh ? fmtKwh(r.total.kwh) : ''}</b></td>
            <td class="num"><b>{r.total.kwh ? fmtEur(r.total.eur) : ''}</b></td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <th colspan="2">Yhteensä</th>
          {#each cols as c (c.key)}
            {@const t = result.totals[c.key]}
            <th class="num">{fmtKwh(t.kwh)}</th>
            <th class="num">{t.unknown ? '≥ ' : ''}{fmtEur(t.eur)}</th>
          {/each}
          <th class="num">{fmtKwh(grand.kwh)}</th>
          <th class="num">{grand.unknown ? '≥ ' : ''}{fmtEur(grand.eur)}</th>
        </tr>
      </tfoot>
    </table>
  </div>
  {#if Object.values(result.totals).some((t) => t.outside > 0)}
    <p class="small muted">Yli puolenyön jatkuva käyttö on mukana laitteen yhteissummassa seuraavan päivän hinnoilla.</p>
  {/if}
{/if}

<style>
  th.dev { text-align: center; border-left: 1px solid var(--border); white-space: nowrap; }
  tfoot th { color: var(--text); border-top: 2px solid var(--border); }
</style>
