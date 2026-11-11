<script>
  import { onMount } from 'svelte';
  import { parseConsumptionCsv, joinPrices, analyze, estimateBaseW, tips } from './lib/consumption.js';
  import { DEFAULT_SETTINGS, localDate, addDays, hhmm, weekdayShort, fmtEur, fmtKwh, fmtPrice, helsinkiToUtc } from './lib/pricing.js';
  import { load, loadOr, save } from './lib/storage.js';
  import { echart, cssVar, colorScheme, screen } from './lib/chart.svelte.js';
  import { VERSION } from './changelog.js';

  const base = (window.SPORSSI_CONFIG?.apiBase ?? 'api').replace(/\/$/, '');
  const settings = load('sporssi.settings', DEFAULT_SETTINGS); // ALV ja marginaali pääsivun asetuksista
  const scheme = colorScheme();
  const STORE = 'sporssi.kulutus';

  let opts = $state(load('sporssi.kulutus.asetukset', { fixedPrice: 10, shiftShare: 0.2, period: 'kuukausi', remember: false }));
  $effect(() => save('sporssi.kulutus.asetukset', $state.snapshot(opts)));

  let parsed = $state(null);       // jäsennetty tiedosto
  let fileName = $state('');
  let error = $state('');
  let loading = $state('');
  let spot = $state(null);         // Map t -> c/kWh ALV 0
  let priceFirst = $state(null);   // hintahistorian ensimmäinen päivä (VVVV-KK-PP)
  let dragOver = $state(false);

  // --- tiedoston luku -----------------------------------------------------------------------
  async function readFile(file) {
    error = '';
    try {
      const text = await file.text();
      const p = parseConsumptionCsv(text);
      parsed = p;
      fileName = file.name;
      if (opts.remember) remember();
      await loadPrices();
    } catch (e) {
      error = e.message;
      parsed = null;
    }
  }
  function remember() {
    if (!parsed) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({
        fileName, format: parsed.format, resolutionMin: parsed.resolutionMin, estimated: parsed.estimated,
        skipped: parsed.skipped, readingType: parsed.readingType,
        p: parsed.points.map((x) => [x.t, Math.round(x.kwh * 10000) / 10000, x.min, x.est ? 1 : 0]),
      }));
    } catch { error = 'Tietojen tallennus selaimeen ei onnistunut (tila täynnä?).'; }
  }
  function forget() {
    try { localStorage.removeItem(STORE); } catch { /* ei tallennusta */ }
    opts.remember = false;
  }
  $effect(() => { if (!opts.remember) { try { localStorage.removeItem(STORE); } catch { /* */ } } else if (parsed) remember(); });

  onMount(() => {
    const s = loadOr(STORE, null);
    if (s && Array.isArray(s.p)) {
      parsed = { ...s, points: s.p.map(([t, kwh, min, est]) => ({ t, kwh, min, est: !!est })) };
      fileName = s.fileName;
      loadPrices();
    }
  });

  // --- hintahistoria ------------------------------------------------------------------------
  async function loadPrices() {
    if (!parsed?.points.length) return;
    loading = 'Haetaan hintahistoriaa…';
    let first = localDate(parsed.points[0].t);
    const last = localDate(parsed.points[parsed.points.length - 1].t);
    const map = new Map();
    try {
      // Haetaan vain sieltä, mistä palvelimella on hintahistoriaa.
      const st = await fetch(`${base}/stats`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      priceFirst = st?.available?.first ?? null;
      if (priceFirst && priceFirst > first) first = priceFirst;
      let d = first;
      while (d <= last) {
        let e = addDays(d, 365);
        if (e > last) e = last;
        const res = await fetch(`${base}/prices/range?start=${d}&end=${e}`);
        if (!res.ok) throw new Error(`hintahistoria: ${res.status}`);
        const j = await res.json();
        j.prices.forEach((v, i) => { if (v !== null) map.set((j.start + i * j.step) * 1000, v); });
        d = addDays(e, 1);
      }
      spot = map;
      loading = '';
    } catch (e) {
      loading = '';
      error = `Hintahistorian haku epäonnistui: ${e.message}`;
    }
  }

  // --- analyysi -----------------------------------------------------------------------------
  const joined = $derived(parsed && spot ? joinPrices(parsed.points, (t) => spot.get(t) ?? null, settings) : null);
  const lastT = $derived(joined?.rows.length ? joined.rows[joined.rows.length - 1].t : 0);
  const firstT = $derived(joined?.rows.length ? joined.rows[0].t : 0);
  const PERIODS = { viikko: 7, kuukausi: 30, vuosi: 365, kaikki: Infinity };
  const range = $derived.by(() => {
    if (!joined?.rows.length) return null;
    const endDay = localDate(lastT);
    const days = PERIODS[opts.period];
    const startDay = days === Infinity ? localDate(firstT) : addDays(endDay, -(days - 1));
    const from = days === Infinity ? firstT : Math.max(firstT, helsinkiToUtc(startDay, 0, 0));
    return { from, to: lastT + 3600000, startDay, endDay };
  });
  const baseW = $derived(joined ? estimateBaseW(joined.rows) : null);
  const result = $derived(joined && range ? analyze(joined.rows, range.from, range.to, { ...opts, baseW: baseW ?? 0 }) : null);
  const tipList = $derived(result ? tips(result, { ...opts, baseW }) : []);
  const coverageNote = $derived.by(() => {
    if (!joined || !joined.missing) return '';
    const before = priceFirst && parsed ? parsed.points.filter((p) => localDate(p.t) < priceFirst).length : 0;
    const parts = [];
    if (before) parts.push(`Spörssin hintahistoria alkaa ${fmtDay(priceFirst)}, joten sitä vanhempi kulutus (${before.toLocaleString('fi-FI')} riviä) ei ole mukana analyysissa.`);
    if (joined.missing - before > 0) parts.push(`${(joined.missing - before).toLocaleString('fi-FI')} kulutusjaksolle ei löytynyt hintaa, ja ne jätettiin pois.`);
    return parts.join(' ');
  });

  function useBase() {
    const h = load('sporssi.heating', {});
    save('sporssi.heating', { ...h, baseMode: 'oma', baseW });
    baseSaved = true;
  }
  let baseSaved = $state(false);

  // --- kaaviot ------------------------------------------------------------------------------
  const costOption = $derived.by(() => {
    if (!result) return null;
    scheme.dark;
    const monthly = result.nDays > 62;
    const groups = new Map();
    for (const d of result.days) {
      const k = monthly ? d.date.slice(0, 7) : d.date;
      const g = groups.get(k) ?? { kwh: 0, eur: 0 };
      g.kwh += d.kwh; g.eur += d.eur; groups.set(k, g);
    }
    const keys = [...groups.keys()];
    const label = (k) => (monthly ? `${k.slice(5, 7)}/${k.slice(2, 4)}` : `${Number(k.slice(8, 10))}.${Number(k.slice(5, 7))}.`);
    const muted = cssVar('--muted');
    return {
      animation: false,
      legend: { top: 0, textStyle: { color: cssVar('--text') } },
      grid: { left: 4, right: 8, top: 40, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v) => fmtEur(v) },
      xAxis: { type: 'category', data: keys.map(label), axisLabel: { color: muted, hideOverlap: true }, axisTick: { show: false } },
      yAxis: { type: 'value', name: '€', nameTextStyle: { color: muted }, axisLabel: { color: muted, formatter: (v) => fmtPrice(v, 0) },
        splitLine: { lineStyle: { color: cssVar('--border') } } },
      series: [
        { name: 'Pörssisähkö', type: 'bar', data: keys.map((k) => groups.get(k).eur), itemStyle: { color: cssVar('--accent'), borderRadius: [3, 3, 0, 0] } },
        { name: `Kiinteä ${fmtPrice(opts.fixedPrice)} c/kWh`, type: 'bar', data: keys.map((k) => (groups.get(k).kwh * opts.fixedPrice) / 100),
          itemStyle: { color: cssVar('--cost'), borderRadius: [3, 3, 0, 0] } },
      ],
    };
  });
  const profileOption = (kind) => {
    if (!result) return null;
    scheme.dark;
    const muted = cssVar('--muted');
    const isKwh = kind === 'kwh';
    return {
      animation: false,
      grid: { left: 4, right: 8, top: 30, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v) => (isKwh ? `${fmtKwh(v)} kWh` : `${fmtPrice(v)} c/kWh`) },
      xAxis: { type: 'category', data: result.profile.map((p) => String(p.hour).padStart(2, '0')), axisLabel: { color: muted, interval: screen.narrow ? 3 : 1 }, axisTick: { show: false } },
      yAxis: { type: 'value', name: isKwh ? 'kWh / vrk' : 'c/kWh', nameTextStyle: { color: muted, align: 'left' },
        axisLabel: { color: muted }, splitLine: { lineStyle: { color: cssVar('--border') } } },
      series: [{ type: 'bar', data: result.profile.map((p) => (isKwh ? p.kwhPerDay : p.price)),
        itemStyle: { color: isKwh ? cssVar('--accent') : cssVar('--cost'), borderRadius: [3, 3, 0, 0] } }],
    };
  };
  const kwhOption = $derived(profileOption('kwh'));
  const priceOption = $derived(profileOption('price'));

  const fmtDay = (iso) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;
  const fmtHour = (t) => `${weekdayShort(t)} ${fmtDay(localDate(t))} klo ${hhmm(t)}`;
</script>

<a class="skip" href="#sisalto">Siirry sisältöön</a>
<div class="wrap">
  <header class="head">
    <p><a href="./">← Takaisin Spörssiin</a></p>
    <h1>Oma sähkönkulutus</h1>
    <p class="muted">Lataa kulutustietosi CSV-tiedostona, niin näet mitä sähkösi on maksanut pörssihinnalla ja kiinteällä
      hinnalla, mitkä tunnit ja päivät ovat olleet kalleimpia ja paljonko olisit säästänyt ajoittamalla kulutusta.</p>
  </header>

  <main id="sisalto" tabindex="-1">
    <section class="card">
      <h2>Kulutustiedot</h2>
      <details class="howto">
        <summary>Mistä saan tiedoston?</summary>
        <ol>
          <li>Kirjaudu Fingridin Datahubin asiakasportaaliin <a href="https://oma.datahub.fi/" target="_blank" rel="noopener">oma.datahub.fi</a> Suomi.fi-tunnistautumisella.</li>
          <li>Valitse käyttöpaikka ja kulutustiedot, valitse aikaväli (esim. viimeinen vuosi) ja lataa tiedosto CSV-muodossa.</li>
          <li>Valitse tiedosto alta. Myös sähköyhtiön palvelusta ladattu tiedosto, jossa on aika- ja kulutussarakkeet, yleensä käy.</li>
        </ol>
      </details>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="drop" class:over={dragOver}
        ondragover={(e) => { e.preventDefault(); dragOver = true; }}
        ondragleave={() => (dragOver = false)}
        ondrop={(e) => { e.preventDefault(); dragOver = false; const f = e.dataTransfer?.files?.[0]; if (f) readFile(f); }}>
        <label class="file">Valitse CSV-tiedosto
          <input type="file" accept=".csv,text/csv,text/plain" onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) readFile(f); }} />
        </label>
        <span class="muted">tai vedä tiedosto tähän</span>
      </div>
      <p class="small muted">Tiedosto käsitellään vain selaimessasi; kulutustietoja ei lähetetä palvelimelle. Palvelimelta
        haetaan ainoastaan pörssihinnat samalta aikaväliltä.</p>
      <label><input type="checkbox" bind:checked={opts.remember} /> Muista tiedot tässä selaimessa</label>
      {#if opts.remember && parsed}<button type="button" class="forget" onclick={forget}>Unohda tallennetut tiedot</button>{/if}

      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if loading}<p class="muted" role="status">{loading}</p>{/if}
      {#if parsed}
        <p class="small">
          <b>{fileName}</b>: {parsed.points.length.toLocaleString('fi-FI')} riviä
          ({parsed.resolutionMin === 15 ? 'varteittain' : 'tunneittain'}, {parsed.format === 'datahub' ? 'Datahub' : 'yleinen muoto'}),
          {fmtDay(localDate(parsed.points[0].t))}–{fmtDay(localDate(parsed.points[parsed.points.length - 1].t))}.
          {#if parsed.estimated}{parsed.estimated} arvioitua lukemaa.{/if}
          {#if parsed.skipped}{parsed.skipped} riviä ohitettiin.{/if}
        </p>
        {#if coverageNote}<p class="small muted">{coverageNote}</p>{/if}
      {/if}
    </section>

    {#if result}
      <section class="card" aria-labelledby="yhteenveto">
        <h2 id="yhteenveto">Yhteenveto</h2>
        <div class="row controls">
          <div class="seg" role="group" aria-label="Jakso">
            {#each [['viikko', 'Viikko'], ['kuukausi', 'Kuukausi'], ['vuosi', 'Vuosi'], ['kaikki', 'Koko tiedosto']] as [k, l]}
              <button type="button" aria-pressed={opts.period === k} class:on={opts.period === k} onclick={() => (opts.period = k)}>{l}</button>
            {/each}
          </div>
          <label class="field">Kiinteä hinta, c/kWh <input type="number" min="0" step="0.1" bind:value={opts.fixedPrice} /></label>
        </div>
        <p class="small muted">Jakso {fmtDay(localDate(result.from))}–{fmtDay(localDate(result.to - 1))} ({result.nDays} vrk) tiedoston lopusta
          taaksepäin. Pörssihinnassa ALV {fmtPrice(settings.vat, 1)} % ja marginaali {fmtPrice(settings.margin)} c/kWh
          (Spörssin asetuksista); siirto, vero ja perusmaksut eivät sisälly kumpaankaan hintaan.</p>
        <div class="row stats">
          <div class="stat"><span class="muted">Kulutus</span><b class="big">{fmtKwh(result.kwh)}</b><span class="muted">kWh</span></div>
          <div class="stat"><span class="muted">Pörssisähkö</span><b class="big">{fmtEur(result.spotCost)}</b><span class="muted">{fmtPrice(result.paidAvg)} c/kWh keskimäärin</span></div>
          <div class="stat"><span class="muted">Kiinteä hinta</span><b class="big">{fmtEur(result.fixedCost)}</b><span class="muted">{fmtPrice(opts.fixedPrice)} c/kWh</span></div>
          <div class="stat"><span class="muted">{result.fixedCost >= result.spotCost ? 'Pörssisähkö edullisempi' : 'Kiinteä edullisempi'}</span>
            <b class="big">{fmtEur(Math.abs(result.fixedCost - result.spotCost))}</b>
            <span class="muted">jakson tasainen keskihinta {fmtPrice(result.timeAvg)} c/kWh</span></div>
        </div>
        <h3>Kustannus {result.nDays > 62 ? 'kuukausittain' : 'päivittäin'}</h3>
        <div class="chart" style="height: 18rem" role="img"
          aria-label={`Kustannus pörssihinnalla ${fmtEur(result.spotCost)} ja kiinteällä hinnalla ${fmtEur(result.fixedCost)} jaksolla.`}
          use:echart={costOption}></div>
      </section>

      <section class="card" aria-labelledby="vinkit">
        <h2 id="vinkit">Vinkit ja säästöpotentiaali</h2>
        <ul class="tips">{#each tipList as t}<li>{t}</li>{/each}</ul>
        <div class="row controls">
          <label class="field">Siirrettävä osuus joustavasta kulutuksesta, {Math.round(opts.shiftShare * 100)} %
            <input type="range" min="0" max="0.6" step="0.05" bind:value={opts.shiftShare} /></label>
          <p class="saving">Arvioitu säästö: <b>{fmtEur(result.saving)}</b>
            {#if result.spotCost > 0}({fmtPrice((result.saving / result.spotCost) * 100, 0)} % pörssisähkön kustannuksesta){/if}</p>
        </div>
        <p class="small muted">Joustava kulutus = peruskulutuksen ylittävä osa ({fmtKwh(result.flexKwh)} kWh jaksolla). Arviossa valittu
          osuus siitä siirretään saman vuorokauden neljälle halvimmalle tunnille; vuorokauden hinnat tiedetään edellisenä päivänä.</p>
        {#if baseW !== null}
          <h3>Peruskulutus</h3>
          <p>Mitattu peruskulutuksesi on noin <b>{baseW} W</b> ({fmtKwh(baseW * 24 / 1000)} kWh/vrk), arvioituna yöllisten
            tuntien (klo 1–5) pienimmistä lukemista. Lukema sisältää kaiken yöllä päällä olevan, myös mahdollisen lämmityksen.</p>
          <button type="button" onclick={useBase} disabled={baseSaved}>{baseSaved ? 'Tallennettu Spörssin peruskulutukseksi' : 'Käytä Spörssin peruskulutuksena'}</button>
        {/if}
      </section>

      <section class="card" aria-labelledby="profiili">
        <h2 id="profiili">Kulutus ja hinta vuorokauden tunneittain</h2>
        <div class="grid2">
          <div>
            <h3>Kulutuksesi keskimäärin</h3>
            <div class="chart" style="height: 15rem" role="img" aria-label={'Keskimääräinen kulutus tunneittain: ' + result.profile.map((p) => `klo ${p.hour} ${fmtKwh(p.kwhPerDay)} kWh`).join(', ')} use:echart={kwhOption}></div>
          </div>
          <div>
            <h3>Pörssisähkön keskihinta</h3>
            <div class="chart" style="height: 15rem" role="img" aria-label={'Keskihinta tunneittain: ' + result.profile.map((p) => `klo ${p.hour} ${fmtPrice(p.price)} c/kWh`).join(', ')} use:echart={priceOption}></div>
          </div>
        </div>
      </section>

      <section class="card" aria-labelledby="kalleimmat">
        <h2 id="kalleimmat">Kalleimmat tunnit ja päivät</h2>
        <div class="grid2">
          <div class="scroll">
            <h3>Tunnit</h3>
            <table>
              <thead><tr><th>Aika</th><th class="num">kWh</th><th class="num">c/kWh</th><th class="num">€</th></tr></thead>
              <tbody>
                {#each result.topHours as h (h.t)}
                  <tr><td>{fmtHour(h.t)}</td><td class="num">{fmtKwh(h.kwh)}</td><td class="num">{fmtPrice(h.price)}</td><td class="num">{fmtEur(h.eur)}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="scroll">
            <h3>Päivät</h3>
            <table>
              <thead><tr><th>Päivä</th><th class="num">kWh</th><th class="num" title="Maksamasi keskihinta / päivän keskihinta">c/kWh</th><th class="num">€</th></tr></thead>
              <tbody>
                {#each result.topDays as d (d.date)}
                  <tr><td>{weekdayShort(Date.parse(`${d.date}T12:00:00Z`))} {fmtDay(d.date)}</td><td class="num">{fmtKwh(d.kwh)}</td>
                    <td class="num">{fmtPrice(d.price)} / {fmtPrice(d.avgPrice)}</td><td class="num">{fmtEur(d.eur)}</td></tr>
                {/each}
              </tbody>
            </table>
            <p class="small muted">c/kWh: maksamasi keskihinta / päivän tasainen keskihinta.</p>
          </div>
        </div>
      </section>
    {/if}
  </main>

  <footer class="small muted">
    <p><a href="./">Spörssi</a> versio {VERSION} · <a href="./muutokset.html">Muutoshistoria</a></p>
  </footer>
</div>

<style>
  .head h1 { margin: .2rem 0 .4rem; }
  .drop { border: 2px dashed var(--border); border-radius: 10px; padding: 1rem; margin: .6rem 0; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .drop.over { border-color: var(--accent); background: var(--row-alt); }
  .file { display: inline-flex; flex-direction: column; gap: .3rem; font-weight: 600; max-width: 100%; min-width: 0; }
  .file input { max-width: 100%; }
  .forget { margin-left: .6rem; }
  .controls { gap: 1rem; align-items: flex-end; margin: .4rem 0 .6rem; }
  .stats { gap: 1.4rem; margin: .6rem 0; }
  .stat { display: flex; flex-direction: column; min-width: 9rem; }
  .big { font-size: 1.35rem; font-variant-numeric: tabular-nums; }
  .tips li { margin: .3rem 0; }
  .saving { margin: 0; }
  .howto { margin: .3rem 0; }
  footer { padding: 0 .2rem 2rem; }
  input[type='range'] { width: 16rem; max-width: 100%; }
</style>
