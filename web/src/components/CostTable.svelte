<script>
  import { schedule, scheduleToHours } from '../lib/cost.js';
  import { hhmm, fmtEur, fmtKwh, fmtPrice } from '../lib/pricing.js';

  // columns: [{key, name}] ; devices: [{key, dev, startMs}] (sama key -> yksi summasarake) ; extra: [{key, kwhAt}]
  let { daySlots, columns, devices, extra = [], priceAt, resolution, nowMs, unit } = $props();

  const result = $derived(schedule(daySlots, devices, priceAt, extra));
  const rows = $derived(resolution === 'quarter' ? result.rows : scheduleToHours(result.rows));
  const step = $derived(resolution === 'quarter' ? 15 : 60);
  const empty = { kwh: 0, eur: 0, outside: 0, unknown: false };
  const grand = $derived.by(() => {
    let kwh = 0, eur = 0, unknown = false;
    for (const c of columns) {
      const t = result.totals[c.key] ?? empty;
      kwh += t.kwh; eur += t.eur; unknown ||= t.unknown;
    }
    return { kwh, eur, unknown };
  });
  // Solut ilman yksikköä (yksikkö on otsikossa) -> kapeampi taulukko.
  const num = (v) => fmtEur(v).replace(/\s*€$/, '');

  // Kapealla näytöllä osien kWh-sarakkeet piilotetaan (yhteensä-kWh näkyy).
  const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)') : null;
  let narrow = $state(mq?.matches ?? false);
  $effect(() => {
    if (!mq) return;
    const on = (e) => { narrow = e.matches; };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  const span = $derived(narrow ? 1 : 2);
</script>

<div class="scroll">
  <table>
    <thead>
      <tr>
        <th rowspan="2">Klo</th>
        <th rowspan="2" class="num" title="Sähkön hinta {unit}">{narrow ? 'c' : unit}</th>
        {#each columns as c (c.key)}<th colspan={span} class="dev" title={c.title ?? c.name}>{narrow ? (c.tiny ?? c.short ?? c.name) : (c.short ?? c.name)}</th>{/each}
        <th colspan={span} class="dev" title="Yhteensä">Yht.</th>
      </tr>
      <tr>
        {#each columns as c (c.key)}{#if !narrow}<th class="num">kWh</th>{/if}<th class="num">€</th>{/each}
        {#if !narrow}<th class="num">kWh</th>{/if}<th class="num">€</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.t)}
        <tr class:now={nowMs >= r.t && nowMs < r.t + step * 60000}>
          <td>{narrow && step === 60 ? hhmm(r.t).slice(0, 2) : hhmm(r.t)}</td>
          <td class="num">{fmtPrice(r.price)}</td>
          {#each columns as c (c.key)}
            {@const cell = r.cells[c.key]}
            {#if cell && cell.kwh}
              {#if !narrow}<td class="num">{fmtKwh(cell.kwh)}</td>{/if}<td class="num">{num(cell.eur)}</td>
            {:else if cell && cell.kwh === null}
              {#if !narrow}<td class="num muted">?</td>{/if}<td class="num muted">?</td>
            {:else}
              {#if !narrow}<td class="num muted"></td>{/if}<td class="num muted"></td>
            {/if}
          {/each}
          {#if !narrow}<td class="num"><b>{r.total.kwh ? fmtKwh(r.total.kwh) : ''}</b></td>{/if}
          <td class="num"><b>{r.total.kwh ? num(r.total.eur) : ''}</b></td>
        </tr>
      {/each}
    </tbody>
    <tfoot>
      <tr>
        <th colspan="2">Yht.</th>
        {#each columns as c (c.key)}
          {@const t = result.totals[c.key] ?? empty}
          {#if !narrow}<th class="num">{fmtKwh(t.kwh)}</th>{/if}
          <th class="num">{num(t.eur)}{t.unknown ? '*' : ''}</th>
        {/each}
        {#if !narrow}<th class="num">{fmtKwh(grand.kwh)}</th>{/if}
        <th class="num">{num(grand.eur)}{grand.unknown ? '*' : ''}</th>
      </tr>
    </tfoot>
  </table>
</div>
{#if grand.unknown}
  <p class="small muted">* Osa hinnoista tai säätiedoista puuttuu; summa sisältää vain tunnetut tunnit.</p>
{/if}
{#if Object.values(result.totals).some((t) => t.outside > 0)}
  <p class="small muted">Yli puolenyön jatkuva käyttö on mukana yhteissummassa seuraavan päivän hinnoilla.</p>
{/if}

<style>
  th.dev { text-align: center; border-left: 1px solid var(--border); white-space: nowrap; }
  @media (max-width: 640px) {
    th, td { padding: .25rem .2rem; }
  }
  tfoot th { color: var(--text); border-top: 2px solid var(--border); }
</style>
