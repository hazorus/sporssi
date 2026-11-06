<script>
  import { onMount } from 'svelte';
  import echarts from '../lib/echarts.js';
  import { hhmm, fmtKwh, fmtPrice } from '../lib/pricing.js';

  let { options, cfg = $bindable(), data, error, loading, water } = $props();
  let el = $state();
  let chart;

  const system = $derived(options?.systems.find((s) => s.id === cfg.system));
  const location = $derived(options?.locations.find((l) => l.id === cfg.location));
  const era = $derived(options?.eras.find((e) => e.id === cfg.era));

  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function option() {
    const hours = data?.hours ?? [];
    const muted = css('--muted');
    const border = css('--border');
    return {
      animation: false,
      grid: { left: 44, right: 44, top: 28, bottom: 30 },
      legend: { top: 0, textStyle: { color: muted }, data: ['Lämmityssähkö kWh', 'Ulkolämpötila °C'] },
      tooltip: {
        trigger: 'axis',
        formatter: (ps) => {
          const h = hours[ps[0].dataIndex];
          return `${hhmm(Date.parse(h.start))}<br/>${fmtPrice(h.temp, 1)} °C (${h.kind === 'obs' ? 'havainto' : 'ennuste'})`
            + `<br/>Lämpö ${fmtKwh(h.heat_kwh)} kWh<br/>Sähkö <b>${fmtKwh(h.elec_kwh)} kWh</b>`
            + (h.cop ? `<br/>COP ${fmtPrice(h.cop, 1)}` : '');
        },
      },
      xAxis: {
        type: 'category', data: hours.map((h) => hhmm(Date.parse(h.start)).slice(0, 2)),
        axisLabel: { color: muted, interval: 1 }, axisLine: { lineStyle: { color: border } }, axisTick: { show: false },
      },
      yAxis: [
        { type: 'value', name: 'kWh', min: 0, nameTextStyle: { color: muted }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: border } } },
        { type: 'value', name: '°C', nameTextStyle: { color: muted }, axisLabel: { color: muted }, splitLine: { show: false } },
      ],
      series: [
        { name: 'Lämmityssähkö kWh', type: 'bar', data: hours.map((h) => h.elec_kwh), itemStyle: { color: css('--accent') } },
        { name: 'Ulkolämpötila °C', type: 'line', yAxisIndex: 1, data: hours.map((h) => h.temp), smooth: true,
          symbol: 'none', lineStyle: { color: css('--now'), width: 2 }, itemStyle: { color: css('--now') } },
      ],
    };
  }

  onMount(() => {
    const onResize = () => chart?.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart?.dispose(); };
  });
  $effect(() => {
    const opt = option();
    if (!el) { chart?.dispose(); chart = null; return; }
    if (!chart || chart.getDom() !== el) { chart?.dispose(); chart = echarts.init(el); }
    chart.setOption(opt, true);
  });
</script>

<h3>Rakennuksen lämmitys</h3>
{#if options}
  <div class="row controls">
    <label class="field">Paikkakunta
      <select bind:value={cfg.location}>
        {#each options.locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </label>
    <label class="field">Lämmitystapa
      <select bind:value={cfg.system}>
        {#each options.systems as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
      </select>
    </label>
    <label class="field">Arvion peruste
      <select bind:value={cfg.mode}>
        <option value="era">pinta-ala ja rakennusvuosi</option>
        <option value="annual">tunnettu vuotuinen lämmitystarve</option>
      </select>
    </label>
    {#if cfg.mode === 'era'}
      <label class="field">Pinta-ala, m² <input type="number" min="10" step="1" bind:value={cfg.area} /></label>
      <label class="field">Rakennusvuosi
        <select bind:value={cfg.era}>
          {#each options.eras as e (e.id)}<option value={e.id}>{e.label} ({e.kwh_m2_a} kWh/m²)</option>{/each}
        </select>
      </label>
    {:else}
      <label class="field">Lämmitystarve, kWh/v <input type="number" min="0" step="100" bind:value={cfg.annual_kwh} /></label>
    {/if}
    <label class="field">Sisälämpö, °C <input type="number" min="15" max="26" step="0.5" bind:value={cfg.indoor} /></label>
  </div>

  {#if error}<p class="error small">{error}</p>{/if}
  {#if data}
    <p class="small">
      Arvioitu lämmityssähkö: <b>{fmtKwh(data.total_elec_kwh)} kWh</b> (lämpöenergiaa {fmtKwh(data.total_heat_kwh)} kWh).
      Vuotuinen lämmitystarve {data.annual_heat_kwh.toLocaleString('fi-FI')} kWh,
      lämmitystarveluku {location?.degree_days.toLocaleString('fi-FI')} °Cd.
      {#if !data.complete}<span class="pill">osa tunneista ilman säätietoa</span>{/if}
      {#if loading}<span class="muted">päivitetään…</span>{/if}
    </p>
    <div class="chart" bind:this={el}></div>
  {/if}
  <details class="small muted">
    <summary>Miten lämmitys arvioidaan?</summary>
    <p>
      Rakennuksen lämpöhäviö lasketaan vuotuisesta lämmitystarpeesta ja paikkakunnan normaalivuoden
      lämmitystarveluvusta (Ilmatieteen laitos, S17, 1991–2020). Kunkin tunnin lämmitystarve on verrannollinen
      eroon ulkolämpötilan ja 17 °C:n välillä (sisälämpö 21 °C; muut lämmönlähteet kattavat loput).
      Lämpötilat ovat Ilmatieteen laitoksen havaintoja ja ennusteita. Lämpöpumpun sähkönkulutus = lämpö / COP;
      lämpöpumpun ulkopuolelle jäävä osuus ({Math.round((1 - (system?.coverage ?? 1)) * 100)} %) lasketaan suoralla sähköllä.
      Käyttöveden lämmitys lasketaan erikseen alla.
    </p>
    {#if system?.notes}<p>{system.notes}</p>{/if}
    <ul>
      {#each [...(system?.sources ?? []), ...(era?.sources ?? []), ...(location?.sources ?? [])] as s}
        <li>{#if s.url}<a href={s.url} target="_blank" rel="noopener">{s.name}</a>{:else}{s.name}{/if}</li>
      {/each}
    </ul>
  </details>
{/if}


<h3 class="water">Lämmin vesi</h3>
<div class="row controls">
  <label class="field">Henkilöitä <input type="number" min="0" max="20" step="1" bind:value={cfg.persons} /></label>
  <label class="field">kWh / henkilö / vrk <input type="number" min="0" step="0.1" bind:value={cfg.waterPerPerson} /></label>
  <label class="field">Lämmitys
    <select bind:value={cfg.waterMode}>
      <option value="varaaja">varaaja, ajastettu</option>
      <option value="tasainen">tasaisesti läpi vuorokauden</option>
    </select>
  </label>
  {#if cfg.waterMode === 'varaaja'}
    <label class="field">Alkaa klo <input type="time" step="900" bind:value={cfg.waterStart} /></label>
    <label class="field">Vastuksen teho, kW <input type="number" min="0.5" step="0.5" bind:value={cfg.waterPower} /></label>
  {/if}
</div>
{#if water}
  <p class="small muted">
    Vuorokaudessa {fmtKwh(water.kind === 'continuous' ? water.annual_kwh / 365 : water.power_kw * water.duration_min / 60)} kWh{#if water.kind !== 'continuous'},
    lämmitys kestää n. {Math.floor(water.duration_min / 60)} h {water.duration_min % 60} min{/if}.
    Oletus 2,5 kWh/hlö/vrk perustuu Motivan esimerkkitaloon (lämmin vesi 3 670 kWh/v, 4 henkeä).
  </p>
{/if}

<style>
  .controls { margin: .6rem 0; align-items: flex-end; }
  .chart { width: 100%; height: 240px; }
  h3.water { margin-top: 1rem; }
</style>
