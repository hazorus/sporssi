<script>
  import { echart, cssVar, screen, remPx } from '../lib/chart.svelte.js';
  import { persistOpen } from '../lib/persist.js';
  import { runCost, bestStart, deviceEnergy } from '../lib/cost.js';
  import { SLOT_MS, hhmm, weekdayShort, fmtEur, fmtKwh, fmtPrice, esc } from '../lib/pricing.js';

  // devices: [{key, dev}] valitut laitteet, priceAt: tämän päivän + huomisen hinnat
  // part: 'now' = käyttö nyt -kaavio, 'future' = käyttökustannus eri aloitusaikoina (sivun lopussa)
  let { devices, priceAt, nowMs, lastKnownMs, scheme, unit, priceLine = [], part = 'now' } = $props();
  const nowPrice = $derived(priceLine.find((p) => nowMs >= p.t && nowMs < p.t + SLOT_MS) ?? null);

  let relative = $state(false);
  let futureOpen = $state(false);

  // Hiiren alla olevan laitteen nimi korostetaan selitteessä ja työkaluvihjeessä.
  let hovered = null;
  function legendFormatter(name) {
    const safe = String(name).replace(/[{}|]/g, '');
    return name === hovered ? `{hi|${safe}}` : safe;
  }
  function setupFuture(chart) {
    const set = (name) => {
      if (name === hovered) return;
      hovered = name;
      chart.setOption({ legend: { formatter: legendFormatter } });
    };
    chart.on('mouseover', { componentType: 'series' }, (p) => set(p.seriesName));
    chart.on('mouseout', { componentType: 'series' }, () => set(null));
    chart.on('highlight', (e) => { if (e.name) set(e.name); });
    chart.on('downplay', () => set(null));
    chart.on('globalout', () => set(null));
  }
  const nowStart = $derived(Math.floor(nowMs / SLOT_MS) * SLOT_MS);
  const usable = $derived(devices.filter((d) => d.dev.kind !== 'continuous'));
  const skipped = $derived(devices.filter((d) => d.dev.kind === 'continuous'));

  // Aloitusajat: nyt ja sen jälkeen jokainen tasatunti niin pitkälle kuin hintoja on.
  const starts = $derived.by(() => {
    const out = [nowStart];
    let t = Math.ceil((nowStart + 1) / 3600000) * 3600000;
    for (; t <= lastKnownMs; t += 3600000) out.push(t);
    return out;
  });

  const rows = $derived(usable.map(({ key, dev }) => {
    let eur = runCost(dev, nowStart, priceAt);
    let approx = false;
    if (eur === null) {
      // Käyttö jatkuu yli tunnettujen hintojen: arvio nykyhinnalla.
      const p = priceAt(nowStart);
      eur = p === null ? null : (deviceEnergy(dev) * p) / 100;
      approx = true;
    }
    const best = bestStart(dev, starts, priceAt);
    return { key, dev, eur, approx, best, series: starts.map((t) => runCost(dev, t, priceAt)) };
  }));

  function label(t) {
    const h = hhmm(t);
    return h === '00:00' ? `${weekdayShort(t)} ${h}` : h;
  }

  const nowOption = $derived.by(() => {
    scheme.dark;
    const muted = cssVar('--muted');
    const border = cssVar('--border');
    const list = [...rows].reverse(); // ensimmäinen ylimpänä
    const narrow = screen.narrow;
    const fs = remPx();
    // Hinta näytetään palkin sisällä, kun palkki on tarpeeksi pitkä, muuten sen perässä
    // (lyhyen palkin perässä on aina tilaa), joten kaavion oikealle ei tarvita marginaalia.
    const max = Math.max(0.0001, ...list.map((r) => (r.eur === null ? 0 : r.eur)));
    // Taustan hintakäyrä omassa koordinaatistossaan (tämän päivän klo 00–24), palkkien alla.
    const line = priceLine.filter((p) => p.v !== null);
    const hasLine = line.length > 1;
    const vals = line.map((p) => p.v);
    const yMin = Math.min(0, ...vals);
    const yMax = Math.max(1, ...vals) * 1.15;
    const t0 = priceLine[0]?.t ?? 0;
    const t1 = (priceLine[priceLine.length - 1]?.t ?? 0) + SLOT_MS;
    const np = nowPrice && nowPrice.v !== null ? nowPrice : null;
    const npColor = np ? (np.cls === 'none' ? muted : cssVar(`--${np.cls}`)) : muted;
    const labelLeft = np && (np.t - t0) / Math.max(1, t1 - t0) > 0.6;
    const rightPad = hasLine ? fs * 2.6 : (narrow ? 2 : fs * 1.6);
    return {
      animation: false,
      // Puhelimessa laitteen nimi on palkin yläpuolella, jolloin palkit saavat koko leveyden.
      // Molemmat koordinaatistot jättävät oikealle tilaa hinta-asteikolle (c/kWh) ja ylös
      // kellonajoille. Pystyakselilla ovat laitteet, joten hinta-asteikko ei kilpaile niiden kanssa.
      grid: [
        narrow
          ? { left: 2, right: rightPad, top: fs * 2.8, bottom: 2 }
          : { left: 8, right: rightPad, top: fs * 2.6, bottom: 8, containLabel: true },
        { left: 0, right: rightPad, top: fs * 2.6, bottom: narrow ? 2 : fs * 1.8 },
      ],
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const r = list[p.dataIndex];
          let s = `<b>${esc(r.dev.name)}</b><br/>${fmtKwh(deviceEnergy(r.dev))} kWh, ${r.dev.duration_min} min`
            + `<br/>Aloitus nyt: <b>${fmtEur(r.eur)}</b>${r.approx ? ' (arvio nykyhinnalla)' : ''}`;
          if (r.best && r.eur !== null && r.best.eur < r.eur - 0.005) {
            s += `<br/>Halvin aloitus ${label(r.best.t)}: ${fmtEur(r.best.eur)}`;
          }
          return s;
        },
      },
      xAxis: [{
        type: 'value', min: 0,
        axisLabel: { show: !narrow, color: muted, formatter: (v) => `${fmtPrice(v, v < 1 ? 2 : 1)} €` },
        splitLine: { lineStyle: { color: border } },
      }, {
        type: 'value', gridIndex: 1, min: t0, max: t1, interval: 6 * 3600000, position: 'top',
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        // Päivän lopun 00 jätetään pois: tilalla on hinta-asteikon yksikkö.
        axisLabel: { show: hasLine, color: muted, formatter: (v) => (v >= t1 - 60000 ? '' : hhmm(v).slice(0, 2)) },
      }],
      yAxis: [{
        type: 'category', data: list.map((r) => r.dev.name),
        axisLabel: narrow
          ? { inside: true, align: 'left', verticalAlign: 'bottom', padding: [0, 0, Math.round(fs * 0.55), 0], color: cssVar('--text') }
          : { color: cssVar('--text') },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: border } },
        z: 3,
      }, {
        type: 'value', gridIndex: 1, min: yMin, max: yMax, position: 'right', show: hasLine,
        name: unit, nameLocation: 'end', nameGap: Math.round(fs * 0.5), nameTextStyle: { color: muted, align: 'right', verticalAlign: 'bottom' },
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: muted, formatter: (v) => fmtPrice(v, 0) },
      }],
      series: [...(hasLine ? [{
        type: 'line', xAxisIndex: 1, yAxisIndex: 1, z: 1, silent: true, step: 'end', showSymbol: false,
        data: [...line.map((p) => [p.t, p.v]), [t1, line[line.length - 1].v]],
        lineStyle: { color: muted, width: 2, opacity: narrow ? 0.35 : 0.45 },
        areaStyle: { color: muted, opacity: 0.07 },
        markLine: np ? {
          silent: true, symbol: 'none', lineStyle: { color: cssVar('--now'), type: 'dashed', width: 1.5, opacity: 0.8 },
          label: { show: false }, data: [{ xAxis: np.t }],
        } : undefined,
      }] : []), ...(hasLine && np ? [{
        // Hinta nyt: korostettu piste ja arvo hintakäyrällä, palkkien päällä.
        type: 'scatter', xAxisIndex: 1, yAxisIndex: 1, z: 5, silent: true,
        data: [[np.t + SLOT_MS / 2, np.v]],
        symbol: 'circle', symbolSize: Math.round(fs * 0.9),
        itemStyle: { color: npColor, borderColor: cssVar('--card'), borderWidth: 2, opacity: 1 },
        label: {
          // Puhelimessa hinta näytetään kaavion yläpuolella, ettei se peitä laitteiden nimiä.
          show: !narrow, position: labelLeft ? 'left' : 'right', distance: Math.round(fs * 0.5),
          formatter: `nyt ${fmtPrice(np.v)} ${unit}`, color: cssVar('--text'), fontWeight: 'bold',
          backgroundColor: cssVar('--card'), borderColor: npColor, borderWidth: 1.5, borderRadius: 4,
          padding: [Math.round(fs * 0.15), Math.round(fs * 0.4)],
        },
      }] : []), {
        type: 'bar', z: 3, barMaxWidth: fs * 1.6, ...(narrow ? { barWidth: Math.round(fs * 0.8) } : {}),
        data: list.map((r) => {
          const inside = r.eur !== null && r.eur >= max * 0.6;
          return {
            value: r.eur === null ? null : Math.max(0, r.eur),
            itemStyle: { color: cssVar('--accent') },
            label: inside
              ? { position: 'insideRight', color: '#fff', fontWeight: 'bold' }
              : { position: 'right', color: cssVar('--text') },
          };
        }),
        label: {
          show: true, position: 'right', color: cssVar('--text'),
          formatter: (p) => fmtEur(list[p.dataIndex].eur),
        },
      }],
    };
  });

  // Kaavioiden tekstivastineet ruudunlukijalle.
  const nowLabel = $derived(`Käyttökustannus, jos laite käynnistetään nyt klo ${hhmm(nowStart)}`
    + (nowPrice && nowPrice.v !== null ? ` (sähkön hinta nyt ${fmtPrice(nowPrice.v)} ${unit})` : '') + ': '
    + rows.map((r) => `${r.dev.name} ${fmtEur(r.eur)}`).join(', ') + '.');
  const futureLabel = $derived('Halvin aloitusaika tunnettujen hintojen perusteella: '
    + rows.map((r) => (r.best ? `${r.dev.name} ${spoken(r.best.t)}, ${fmtEur(r.best.eur)}` : `${r.dev.name} ei tiedossa`)).join('; ') + '.');
  // Ruudunlukijalle päivä mukaan, jos aloitus on huomenna.
  function spoken(t) {
    const sameDay = weekdayShort(t) === weekdayShort(nowMs);
    return `${sameDay ? 'tänään' : weekdayShort(t)} klo ${hhmm(t)}`;
  }

  // Puhelimessa selite rivitetään kaavion alle; arvioidaan rivien määrä nimien pituudesta.
  const legendRows = $derived.by(() => {
    if (!screen.narrow) return 0;
    const fs = remPx();
    const avail = Math.max(200, (typeof window !== 'undefined' ? window.innerWidth : 360) - 40);
    let rowsN = 1, x = 0;
    for (const r of rows) {
      const w = r.dev.name.length * fs * 0.48 + fs * 2;
      if (x > 0 && x + w > avail) { rowsN += 1; x = 0; }
      x += w;
    }
    return rowsN;
  });
  const futureOption = $derived.by(() => {
    scheme.dark;
    const muted = cssVar('--muted');
    const border = cssVar('--border');
    const narrow = screen.narrow;
    const midnight = starts.findIndex((t, i) => i > 0 && hhmm(t) === '00:00');
    const fmt = (v) => (v === null || v === undefined ? '–' : relative ? `${Math.round(v)} %` : fmtEur(v));
    return {
      animation: false,
      grid: narrow
        ? { left: 2, right: remPx() * 1.4, top: remPx() * 1.6, bottom: legendRows * remPx() * 1.6 + 8, containLabel: true }
        : { left: 8, right: remPx() * 1.8, top: remPx() * 2.8, bottom: 8, containLabel: true },
      legend: {
        ...(narrow ? { type: 'plain', bottom: 0, left: 0, itemWidth: 16, itemGap: 6 } : { type: 'scroll', top: 0 }),
        formatter: legendFormatter,
        textStyle: {
          color: muted,
          rich: { hi: { color: cssVar('--text'), fontWeight: 'bold', backgroundColor: cssVar('--row-alt'), padding: [2, 4], borderRadius: 3 } },
        },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (ps) => {
          const items = [...ps].filter((p) => p.value !== null && p.value !== undefined)
            .sort((a, b) => a.value - b.value);
          const head = ps.length ? ps[0].name : '';
          return `Aloitus ${esc(head)}<br/>` + items.map((p) => {
            const line = `${p.marker}${esc(p.seriesName)}: ${fmt(p.value)}`;
            return p.seriesName === hovered ? `<b>${line}</b>` : line;
          }).join('<br/>');
        },
      },
      xAxis: {
        type: 'category', data: starts.map(label), boundaryGap: false,
        axisLabel: { color: muted, hideOverlap: true },
        axisLine: { lineStyle: { color: border } },
      },
      yAxis: {
        type: 'value', min: relative ? 0 : undefined,
        axisLabel: { color: muted, formatter: (v) => (relative ? `${v} %` : `${fmtPrice(v, 2)} €`) },
        splitLine: { lineStyle: { color: border } },
      },
      series: rows.map((r, i) => ({
        name: r.dev.name, type: 'line', showSymbol: false, connectNulls: false, triggerLineEvent: true,
        lineStyle: { width: 2 },
        data: relative
          ? r.series.map((v) => (v === null || !(r.series[0] > 0.00001) ? null : (100 * v) / r.series[0]))
          : r.series,
        emphasis: { focus: 'series', lineStyle: { width: 4 } },
        blur: { lineStyle: { opacity: 0.25 } },
        ...(i === 0 && midnight > 0 ? {
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { color: muted, type: 'dashed' },
            label: { formatter: weekdayShort(starts[midnight]), color: muted, position: 'end' },
            data: [{ xAxis: midnight }],
          },
        } : {}),
      })),
    };
  });
</script>

{#if usable.length === 0}
  {#if part === 'now'}
    <p class="muted"><a href="#laitteet">Valitse laitteita</a>, niin näet niiden käyttökustannuksen nyt ja tulevina tunteina.</p>
  {:else}
    <h2>Käyttökustannus eri aloitusaikoina</h2>
    <p class="muted"><a href="#laitteet">Valitse laitteita</a>, niin näet niiden käyttökustannuksen eri aloitusaikoina.</p>
  {/if}
{:else if part === 'now'}
  {#if screen.narrow && nowPrice && nowPrice.v !== null}
    <p class="nowprice"><span class="swatch c-{nowPrice.cls}" aria-hidden="true"></span>
      Sähkö nyt <b>{fmtPrice(nowPrice.v)} {unit}</b></p>
  {/if}
  <div class="chart" role="img" aria-label={nowLabel} style="height: {Math.max(140, remPx() * (screen.narrow ? 1.6 + usable.length * 3 : 2.5 + usable.length * 2.2))}px" use:echart={nowOption}></div>
  <p class="small muted">Kustannus lasketaan käytön ajan varttihinnoilla ({unit}) alkaen kuluvasta vartista.
    Taustalla tämän päivän pörssisähkön hinta: kellonajat yläreunassa, hinta ({unit}) oikeassa reunassa; piste näyttää hinnan nyt.
    {#if skipped.length}Jatkuvasti käyvät laitteet ({skipped.map((d) => d.dev.name).join(', ')}) eivät ole tässä mukana.{/if}</p>
{:else}
  <!-- Oletuksena suljettu; kaavio piirretään vasta avattaessa. -->
  <details class="future" bind:open={futureOpen} use:persistOpen={'aloitusajat'}>
    <summary><h2>Käyttökustannus eri aloitusaikoina</h2></summary>
    {#if futureOpen}
      <div class="row seg-row">
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="Asteikko">
          <button type="button" aria-pressed={!relative} class:on={!relative} onclick={() => (relative = false)}>€</button>
          <button type="button" aria-pressed={relative} class:on={relative} onclick={() => (relative = true)}>% nykyhetkestä</button>
        </div>
      </div>
      {#if starts.length > 1}
        <div class="chart" role="img" aria-label={futureLabel} style="height: {320 + legendRows * remPx() * 1.6}px" use:echart={{ option: futureOption, setup: setupFuture }}></div>
        <p class="small muted">Jokainen viiva näyttää, mitä laitteen käyttökerta maksaa, jos se käynnistetään kyseisellä
          tunnilla{#if relative}, prosentteina siitä, mitä se maksaisi heti käynnistettynä{/if}. Viiva päättyy, kun käyttö
          jatkuisi yli tunnettujen hintojen. Laitteen voi piilottaa napsauttamalla sen nimeä.</p>
      {:else}
        <p class="muted">Tulevien tuntien hintoja ei vielä ole.</p>
      {/if}
    {/if}
  </details>
{/if}

<style>
  .chart { width: 100%; }
  .nowprice { margin: 0 0 .3rem; }
  h3 { margin-top: .4rem; }
  details.future { margin: 0; }
  details.future > summary { cursor: pointer; }
  details.future > summary h2 { display: inline; margin: 0; }
  .seg-row { margin: .4rem 0; }
</style>
