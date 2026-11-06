<script>
  import { onMount } from 'svelte';
  import { api } from './lib/api.js';
  import { load, loadList, loadOr, save } from './lib/storage.js';
  import { colorScheme } from './lib/chart.svelte.js';
  import {
    DEFAULT_SETTINGS, userPrice, bands as makeBands, normalizeSlots, toHours, hhmm, dayLabel,
    localDate, addDays, fmtPrice, CLASS_LABELS, classify,
  } from './lib/pricing.js';
  import { startMsFor } from './lib/cost.js';
  import PriceChart from './components/PriceChart.svelte';
  import PriceTable from './components/PriceTable.svelte';
  import Devices from './components/Devices.svelte';
  import CostTable from './components/CostTable.svelte';
  import Heating from './components/Heating.svelte';
  import Settings from './components/Settings.svelte';
  import NowCosts from './components/NowCosts.svelte';

  const DEFAULT_HEATING = {
    enabled: false, location: 'helsinki', system: 'ilp', mode: 'era', area: 120,
    era: '1986-2002', annual_kwh: 15000, indoor: 21,
  };

  let settings = $state(load('sporssi.settings', DEFAULT_SETTINGS));
  // Ensikäynnillä valittuna tyypillisimmät kodinkoneet.
  const DEFAULT_SELECTION = Object.fromEntries([
    ['pyykinpesukone-60', '18:00'], ['astianpesukone', '19:00'], ['vedenkeitin', '07:00'],
    ['sahkouuni', '17:00'], ['liesi', '17:00'], ['mikroaaltouuni', '12:00'],
    ['kuivausrumpu-lp', '20:00'], ['kiuas', '18:00'],
  ].map(([id, start]) => [id, { start }]));
  const oldSelection = loadOr('sporssi.selection', {});
  let selection = $state(loadOr('sporssi.selection.v2',
    Object.keys(oldSelection).length ? oldSelection : DEFAULT_SELECTION));
  let custom = $state(loadList('sporssi.custom'));
  let heatCfg = $state(load('sporssi.heating', DEFAULT_HEATING));
  $effect(() => save('sporssi.settings', $state.snapshot(settings)));
  $effect(() => save('sporssi.selection.v2', $state.snapshot(selection)));
  $effect(() => save('sporssi.custom', $state.snapshot(custom)));
  $effect(() => save('sporssi.heating', $state.snapshot(heatCfg)));

  let nowMs = $state(Date.now());
  const today = $derived(localDate(nowMs));
  let date = $state(localDate(Date.now()));
  let showSettings = $state(false);

  let stats = $state(null);
  let available = $state(null);
  let catalog = $state([]);
  let heatOptions = $state(null);
  let loadError = $state('');
  let days = $state({}); // VVVV-KK-PP -> { slots, complete, at }
  let heatData = $state(null);
  let heatError = $state('');
  let heatLoading = $state(false);

  const inflight = new Set();
  async function fetchDay(d, force = false) {
    const have = days[d];
    if (have && have.complete && !force) return;
    if (have && !force && Date.now() - have.at < 5 * 60000) return;
    if (inflight.has(d)) return;
    inflight.add(d);
    try {
      const res = await api.prices(d);
      days[d] = { slots: normalizeSlots(res.slots), complete: res.complete, at: Date.now() };
      loadError = '';
    } catch (e) {
      loadError = `Hintojen haku epäonnistui: ${e.message}`;
    } finally {
      inflight.delete(d);
    }
  }

  onMount(() => {
    api.stats().then((r) => { stats = r.stats; available = r.available; }).catch(() => {});
    api.devices().then((r) => { catalog = r; }).catch((e) => { loadError = `Laitteiden haku epäonnistui: ${e.message}`; });
    api.heatingOptions().then((r) => { heatOptions = r; }).catch(() => {});
    const timer = setInterval(() => {
      nowMs = Date.now();
      for (const d of new Set([addDays(date, -1), date, addDays(date, 1), today, addDays(today, 1)])) {
        if (days[d] && !days[d].complete && d <= addDays(today, 1)) fetchDay(d);
      }
    }, 60000);
    return () => clearInterval(timer);
  });

  // Käyttö nyt -kaaviot tarvitsevat aina tämän päivän ja huomisen hinnat.
  $effect(() => {
    fetchDay(today);
    fetchDay(addDays(today, 1));
  });

  $effect(() => {
    const d = date;
    fetchDay(d);
    fetchDay(addDays(d, -1));
    if (d < addDays(today, 1)) fetchDay(addDays(d, 1));
  });

  const bands = $derived(makeBands(stats, settings));
  const unit = $derived(settings.priceMode === 'spot' ? 'c/kWh (ALV 0)' : 'c/kWh');
  const cur = $derived(days[date]);
  const daySlots = $derived(cur?.slots ?? []);
  const hours = $derived(toHours(daySlots));
  const priceMap = $derived.by(() => {
    const m = new Map();
    for (const d of [addDays(date, -1), date, addDays(date, 1)]) {
      for (const s of days[d]?.slots ?? []) m.set(s.t, userPrice(s.spot, settings));
    }
    return m;
  });
  const priceAt = $derived((t) => priceMap.get(t) ?? null);

  const scheme = colorScheme();
  const nowPrices = $derived.by(() => {
    const m = new Map();
    let last = 0;
    for (const d of [today, addDays(today, 1)]) {
      for (const s of days[d]?.slots ?? []) {
        if (s.spot === null) continue;
        m.set(s.t, userPrice(s.spot, settings));
        last = Math.max(last, s.t);
      }
    }
    return { map: m, last };
  });
  const nowPriceAt = $derived((t) => nowPrices.map.get(t) ?? null);

  const summary = $derived.by(() => {
    const vals = daySlots.filter((s) => s.spot !== null).map((s) => ({ t: s.t, v: userPrice(s.spot, settings), spot: s.spot }));
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b.v, 0) / vals.length;
    const min = vals.reduce((a, b) => (b.v < a.v ? b : a));
    const max = vals.reduce((a, b) => (b.v > a.v ? b : a));
    const now = vals.find((s) => nowMs >= s.t && nowMs < s.t + 15 * 60000);
    return { avg, min, max, now, n: vals.length };
  });

  // Valitut laitteet aikataulua varten
  const allDevices = $derived([...catalog, ...custom]);
  const scheduled = $derived(
    allDevices.filter((d) => selection[d.id]).map((d) => {
      const dev = { ...d, ...selection[d.id] };
      return { key: d.id, dev, startMs: startMsFor(daySlots, dev.start, hhmm) };
    }),
  );

  // Lämmitys
  $effect(() => {
    const c = $state.snapshot(heatCfg);
    const d = date;
    if (!c.enabled) { heatData = null; return; }
    const params = {
      date: d, location: c.location, system: c.system, indoor: c.indoor,
      ...(c.mode === 'era' ? { area: c.area, era: c.era } : { annual_kwh: c.annual_kwh }),
    };
    heatLoading = true;
    const timer = setTimeout(() => {
      api.heating(params)
        .then((r) => { heatData = r; heatError = ''; })
        .catch((e) => { heatError = `Lämmitysarvio epäonnistui: ${e.message}`; heatData = null; })
        .finally(() => { heatLoading = false; });
    }, 300);
    return () => clearTimeout(timer);
  });
  const heatExtra = $derived.by(() => {
    if (!heatCfg.enabled || !heatData || heatData.date !== date) return [];
    const byHour = new Map(heatData.hours.map((h) => [Date.parse(h.start), h.elec_kwh]));
    const name = heatOptions?.systems.find((s) => s.id === heatData.system)?.name ?? 'Lämmitys';
    return [{
      key: 'heating', name: `Lämmitys: ${name}`,
      kwhAt: (t) => {
        const v = byHour.get(t - (t % 3600000));
        return v === null || v === undefined ? null : v / 4;
      },
    }];
  });

  const canNext = $derived(date < addDays(today, 1));
  const canPrev = $derived(!available || date > available.first);
  const tomorrowPending = $derived(date === addDays(today, 1) && cur && !cur.complete);
</script>

<div class="wrap">
  <header class="row head">
    <div>
      <h1>Sporssi</h1>
      <p class="muted small">Pörssisähkön hinta ja kodin laitteiden käyttökustannukset</p>
    </div>
    <span class="spacer"></span>
    <button type="button" onclick={() => (showSettings = !showSettings)}>⚙ Asetukset</button>
  </header>

  {#if showSettings}
    <section class="card"><Settings bind:settings {bands} /></section>
  {/if}

  {#if loadError}<p class="error">{loadError}</p>{/if}

  <section class="card">
    <h2>Laitteiden käyttö nyt</h2>
    <NowCosts devices={scheduled} priceAt={nowPriceAt} {nowMs} lastKnownMs={nowPrices.last} {scheme} {unit} />
  </section>

  <section class="card">
    <div class="row nav">
      <button type="button" disabled={!canPrev} onclick={() => (date = addDays(date, -1))}>◀ Edellinen</button>
      <button type="button" disabled={date === today} onclick={() => (date = today)}>Tänään</button>
      <button type="button" disabled={!canNext} onclick={() => (date = addDays(date, 1))}>Seuraava ▶</button>
      <input type="date" value={date} min={available?.first} max={addDays(today, 1)}
        onchange={(e) => e.currentTarget.value && (date = e.currentTarget.value)} />
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="Tarkkuus">
        <button type="button" class:on={settings.resolution === 'hour'} onclick={() => (settings.resolution = 'hour')}>Tunti</button>
        <button type="button" class:on={settings.resolution === 'quarter'} onclick={() => (settings.resolution = 'quarter')}>15 min</button>
      </div>
    </div>
    <h2 class="day">{dayLabel(date)}{date === today ? ' (tänään)' : date === addDays(today, 1) ? ' (huomenna)' : ''}</h2>

    {#if summary}
      <div class="row stats">
        {#if summary.now && date === today}
          <div class="stat"><span class="muted small">Nyt</span>
            <b class="big"><span class="swatch c-{classify(summary.now.spot, bands)}"></span> {fmtPrice(summary.now.v)}</b>
            <span class="small muted">{unit}</span></div>
        {/if}
        <div class="stat"><span class="muted small">Päivän keskihinta</span><b class="big">{fmtPrice(summary.avg)}</b><span class="small muted">{unit}</span></div>
        <div class="stat"><span class="muted small">Halvin</span><b class="big">{fmtPrice(summary.min.v)}</b><span class="small muted">klo {hhmm(summary.min.t)}</span></div>
        <div class="stat"><span class="muted small">Kallein</span><b class="big">{fmtPrice(summary.max.v)}</b><span class="small muted">klo {hhmm(summary.max.t)}</span></div>
        {#if stats}
          <div class="stat"><span class="muted small">{stats.coverage < 0.9 ? `Keskihinta (${Math.round(stats.slots / 96)} vrk)` : '12 kk keskihinta'}</span><b class="big">{fmtPrice(userPrice(stats.mean, settings))}</b><span class="small muted">hajonta ± {fmtPrice(stats.std)} (ALV 0)</span></div>
        {/if}
      </div>
    {:else if tomorrowPending}
      <p class="muted">Huomisen hinnat julkaistaan noin klo 14 Suomen aikaa.</p>
    {:else if cur}
      <p class="muted">Tälle päivälle ei ole hintatietoja.</p>
    {:else}
      <p class="muted">Ladataan…</p>
    {/if}

    {#if summary && stats && stats.coverage < 0.9}
      <p class="small warn">Tietokannassa on hintahistoriaa vain {Math.round(stats.slots / 96)} vuorokaudelta, joten
        värialueet eivät vielä kuvaa vuoden tasoa. Ylläpitäjä: aja <code>python -m sporssi.cli backfill --days 400</code>.</p>
    {/if}
    {#if summary}
      <PriceChart {scheme} rows={settings.resolution === 'quarter' ? daySlots : hours} {settings} {bands} {nowMs} {unit} />
      <div class="row small legend">
        {#each ['cheap', 'green', 'yellow', 'red'] as c}
          <span><span class="swatch c-{c}"></span> {CLASS_LABELS[c]}</span>
        {/each}
        <span class="muted">Vihreä alue = 12 kk keskihinta ± keskihajonta{settings.autoScale ? '' : ' · kiinteä asteikko'}</span>
      </div>
      <details class="table-toggle">
        <summary>Hintataulukko</summary>
        <PriceTable {hours} {settings} {bands} {nowMs} {unit} />
      </details>
    {/if}
  </section>

  <section class="card">
    <h2>Laitteet</h2>
    <Devices catalog={catalog} bind:custom bind:selection {daySlots} {priceAt} {nowMs} isToday={date === today} />
  </section>

  <section class="card">
    <h2>Sähkölämmitys</h2>
    <Heating options={heatOptions} bind:cfg={heatCfg} data={heatData} error={heatError} loading={heatLoading} />
  </section>

  <section class="card">
    <h2>Kulutus ja kustannukset {settings.resolution === 'quarter' ? 'varteittain' : 'tunneittain'}</h2>
    <CostTable {daySlots} devices={scheduled} extra={heatExtra} {priceAt} resolution={settings.resolution} {nowMs} {unit} />
  </section>

  <footer class="small muted">
    Hinnat: Nord Poolin day-ahead-hinnat alueelle FI (ENTSO-E Transparency Platform / sahkotin.fi).
    Säätiedot: Ilmatieteen laitoksen avoin data. Laitteiden kulutustiedot: Motiva, EU:n energiamerkintä (EPREL),
    Helen; lähteet näkyvät kunkin laitteen kohdalla. Kustannukset ovat arvioita.
  </footer>
</div>

<style>
  .head { margin-bottom: .5rem; }
  .head h1 { font-size: 1.6rem; margin: 0; }
  .head p { margin: .1rem 0 0; }
  .nav { margin-bottom: .6rem; }
  .day { margin: .3rem 0 .6rem; }
  .stats { gap: 1.2rem; margin-bottom: .4rem; }
  .stat { display: flex; flex-direction: column; min-width: 7rem; }
  .big { font-size: 1.35rem; font-variant-numeric: tabular-nums; }
  .legend { gap: 1rem; margin: .2rem 0 .6rem; }
  .table-toggle summary { font-weight: 600; margin: .4rem 0; }
  footer { padding: 0 .2rem 2rem; }
  .warn { border-left: 3px solid var(--yellow); padding: .3rem .6rem; background: var(--row-alt); }
</style>
