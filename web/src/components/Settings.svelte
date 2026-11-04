<script>
  import { DEFAULT_SETTINGS } from '../lib/pricing.js';
  let { settings = $bindable(), bands } = $props();

  function reset() {
    Object.assign(settings, DEFAULT_SETTINGS);
  }
</script>

<div class="grid2">
  <div>
    <h3>Hinnan osat</h3>
    <div class="row">
      <label><input type="radio" bind:group={settings.priceMode} value="spot" /> Pelkkä pörssihinta (ALV 0 %)</label>
      <label><input type="radio" bind:group={settings.priceMode} value="consumer" /> Kuluttajahinta</label>
    </div>
    <div class="row fields" class:dim={settings.priceMode === 'spot'}>
      <label class="field">ALV, % <input type="number" step="0.1" min="0" bind:value={settings.vat} /></label>
      <label class="field">Marginaali, c/kWh <input type="number" step="0.01" bind:value={settings.margin} /></label>
      <label class="field">Siirto, c/kWh <input type="number" step="0.01" min="0" bind:value={settings.transfer} /></label>
      <label class="field">Sähkövero, c/kWh <input type="number" step="0.001" min="0" bind:value={settings.tax} /></label>
    </div>
    <label class="small"><input type="checkbox" bind:checked={settings.includeTax} disabled={settings.priceMode === 'spot'} />
      Lisää sähkövero (sisältää huoltovarmuusmaksun ja ALV:n)</label>
    <p class="small muted">Kuluttajahinta = pörssihinta × (1 + ALV) + marginaali + siirto (+ vero). Negatiiviseen
      pörssihintaan ei lisätä ALV:tä. Marginaali, siirto ja vero annetaan arvonlisäverollisina.</p>
  </div>
  <div>
    <h3>Kaavio ja värit</h3>
    <label><input type="checkbox" bind:checked={settings.autoScale} /> Skaalaa pystyakseli automaattisesti</label>
    <div class="row fields" class:dim={settings.autoScale}>
      <label class="field">Akselin alaraja <input type="number" step="1" bind:value={settings.yMin} disabled={settings.autoScale} /></label>
      <label class="field">Akselin yläraja <input type="number" step="1" bind:value={settings.yMax} disabled={settings.autoScale} /></label>
    </div>
    <div class="row fields">
      <label class="field">Vihreä alue ± hajontaa <input type="number" step="0.1" min="0.1" bind:value={settings.bandK1} /></label>
      <label class="field">Punainen yli ka. + × hajonta <input type="number" step="0.1" min="0.2" bind:value={settings.bandK2} /></label>
    </div>
    {#if bands}
      <p class="small muted">Rajat spot-hinnassa (ALV 0 %): vihreä {bands.low.toFixed(2)}…{bands.high.toFixed(2)} c/kWh,
        keltainen {bands.high.toFixed(2)}…{bands.red.toFixed(2)}, punainen yli {bands.red.toFixed(2)}.</p>
    {/if}
    <button type="button" onclick={reset}>Palauta oletukset</button>
  </div>
</div>

<style>
  .fields { margin: .5rem 0; }
  .fields input { width: 6rem; }
  .dim { opacity: .5; }
</style>
