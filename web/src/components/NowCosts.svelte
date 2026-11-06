<script>
  import { echart, cssVar, screen } from '../lib/chart.svelte.js';
  import { runCost, bestStart, deviceEnergy } from '../lib/cost.js';
  import { SLOT_MS, hhmm, weekdayShort, fmtEur, fmtKwh, fmtPrice } from '../lib/pricing.js';

  // devices: [{key, dev}] valitut laitteet, priceAt: tämän päivän + huomisen hinnat
  let { devices, priceAt, nowMs, lastKnownMs, scheme, unit } = $props();

  let relative = $state(false);

  // Hiiren alla olevan laitteen nimi korostetaan selitteessä ja työkaluvihjeessä.
  let hovered = null;
  function legendFormatter(name) {
    return name === hovered ? `{hi|${name}}` : name;
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
    return {
      animation: false,
      // Puhelimessa laitteen nimi on palkin yläpuolella, jolloin palkit saavat koko leveyden.
      grid: narrow
        ? { left: 2, right: 48, top: 18, bottom: 4 }
        : { left: 8, right: 70, top: 8, bottom: 24, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const r = list[p.dataIndex];
          let s = `<b>${r.dev.name}</b><br/>${fmtKwh(deviceEnergy(r.dev))} kWh, ${r.dev.duration_min} min`
            + `<br/>Aloitus nyt: <b>${fmtEur(r.eur)}</b>${r.approx ? ' (arvio nykyhinnalla)' : ''}`;
          if (r.best && r.eur !== null && r.best.eur < r.eur - 0.005) {
            s += `<br/>Halvin aloitus ${label(r.best.t)}: ${fmtEur(r.best.eur)}`;
          }
          return s;
        },
      },
      xAxis: {
        type: 'value', min: 0,
        axisLabel: { show: !narrow, color: muted, formatter: (v) => `${fmtPrice(v, v < 1 ? 2 : 1)} €` },
        splitLine: { lineStyle: { color: border } },
      },
      yAxis: {
        type: 'category', data: list.map((r) => r.dev.name),
        axisLabel: narrow
          ? { inside: true, align: 'left', verticalAlign: 'bottom', padding: [0, 0, 9, 0], color: cssVar('--text'), fontSize: 12 }
          : { color: cssVar('--text') },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: border } },
        z: 3,
      },
      series: [{
        type: 'bar', barMaxWidth: 22, ...(narrow ? { barWidth: 12 } : {}),
        data: list.map((r) => ({
          value: r.eur === null ? null : Math.max(0, r.eur),
          itemStyle: { color: cssVar('--accent') },
        })),
        label: {
          show: true, position: 'right', color: cssVar('--text'),
          formatter: (p) => fmtEur(list[p.dataIndex].eur),
        },
      }],
    };
  });

  // Puhelimessa selite rivitetään kaavion alle; arvio riveistä (2 nimeä riviä kohden).
  const legendRows = $derived(screen.narrow ? Math.ceil(rows.length / 2) : 0);
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
        ? { left: 2, right: 6, top: 22, bottom: legendRows * 22 + 8, containLabel: true }
        : { left: 8, right: 16, top: 40, bottom: 28, containLabel: true },
      legend: {
        ...(narrow ? { type: 'plain', bottom: 0, left: 0, itemWidth: 16, itemGap: 6 } : { type: 'scroll', top: 0 }),
        formatter: legendFormatter,
        textStyle: {
          color: muted, fontSize: narrow ? 11 : 12,
          rich: { hi: { color: cssVar('--text'), fontWeight: 'bold', backgroundColor: cssVar('--row-alt'), padding: [2, 4], borderRadius: 3 } },
        },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (ps) => {
          const items = [...ps].filter((p) => p.value !== null && p.value !== undefined)
            .sort((a, b) => a.value - b.value);
          const head = ps.length ? ps[0].name : '';
          return `Aloitus ${head}<br/>` + items.map((p) => {
            const line = `${p.marker}${p.seriesName}: ${fmt(p.value)}`;
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
  <p class="muted"><a href="#laitteet">Valitse laitteita</a>, niin näet niiden käyttökustannuksen nyt ja tulevina tunteina.</p>
{:else}
  <h3>Jos käynnistät nyt (klo {hhmm(nowStart)})</h3>
  <div class="chart" style="height: {Math.max(140, (screen.narrow ? 22 : 34) + usable.length * (screen.narrow ? 42 : 34))}px" use:echart={nowOption}></div>
  <p class="small muted">Kustannus lasketaan käytön ajan varttihinnoilla ({unit}) alkaen kuluvasta vartista.
    {#if skipped.length}Jatkuvasti käyvät laitteet ({skipped.map((d) => d.dev.name).join(', ')}) eivät ole tässä mukana.{/if}</p>

  <div class="row">
    <h3>Käyttökustannus eri aloitusaikoina</h3>
    <span class="spacer"></span>
    <div class="seg" role="group" aria-label="Asteikko">
      <button type="button" class:on={!relative} onclick={() => (relative = false)}>€</button>
      <button type="button" class:on={relative} onclick={() => (relative = true)}>% nykyhetkestä</button>
    </div>
  </div>
  {#if starts.length > 1}
    <div class="chart" style="height: {320 + legendRows * 22}px" use:echart={{ option: futureOption, setup: setupFuture }}></div>
    <p class="small muted">Jokainen viiva näyttää, mitä laitteen käyttökerta maksaa, jos se käynnistetään kyseisellä
      tunnilla{#if relative}, prosentteina siitä, mitä se maksaisi heti käynnistettynä{/if}. Viiva päättyy, kun käyttö
      jatkuisi yli tunnettujen hintojen. Laitteen voi piilottaa napsauttamalla sen nimeä.</p>
  {:else}
    <p class="muted">Tulevien tuntien hintoja ei vielä ole.</p>
  {/if}
{/if}

<style>
  .chart { width: 100%; }
  h3 { margin-top: .4rem; }
</style>
