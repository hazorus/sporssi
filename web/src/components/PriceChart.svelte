<script>
  import { onMount } from 'svelte';
  import echarts from '../lib/echarts.js';
  import { screen, applyFont, remPx } from '../lib/chart.svelte.js';
  import { classify, userPrice, hhmm, CLASS_LABELS, fmtPrice, fmtEur, esc, weekdayShort } from '../lib/pricing.js';
  import { runCost, bestStart, deviceSlotEnergy } from '../lib/cost.js';

  // overlays: [{key, dev, startMs, slot}] kaavion päälle valitut laitteet (slot 0–2 = väri)
  // costAt(t): hinta c/kWh käyttökerran kustannuksen laskentaan (myös seuraavan päivän hinnat)
  let { rows, settings, bands, nowMs, unit, scheme, label = 'Pörssisähkön hintakaavio',
    overlays = [], costAt = () => null } = $props();
  let width = $state(0);
  const overlayText = $derived(overlays.length ? ' Kaavioon valitut laitteet: ' + overlays.map((o) => {
    const q = rows.flatMap((h) => h.quarters ?? [h]).map((x) => x.t).filter((t) => t >= nowMs - (nowMs % 900000));
    const b = bestStart(o.dev, q, costAt);
    return `${o.dev.name}, halvin tuleva aloitus ${b ? `${weekdayShort(b.t)} klo ${hhmm(b.t)}, ${fmtEur(b.eur)}` : 'ei tiedossa'}, valittu ${weekdayShort(o.startMs)} klo ${hhmm(o.startMs)} ${fmtEur(runCost(o.dev, o.startMs, costAt))}`;
  }).join('; ') + '.' : '');
  let el;
  let chart;

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function buildOption() {
    const colors = {
      cheap: css('--cheap'), green: css('--green'), yellow: css('--yellow'),
      red: css('--red'), none: css('--none'),
    };
    const text = css('--text');
    const muted = css('--muted');
    const border = css('--border');
    // Palkin kesto aikaleimoista (kahden päivän tuntinäkymässä palkkeja voi olla yli 30).
    const step = rows.length > 1 ? Math.round((rows[1].t - rows[0].t) / 60000) : 60;
    // Yksilölliset kategoriat (viikonpäivä + aika): kahden vuorokauden kaaviossa kellonajat toistuvat.
    const labels = rows.map((r) => `${weekdayShort(r.t)} ${hhmm(r.t)}`);
    const values = rows.map((r) => userPrice(r.spot, settings));
    const fixed = !settings.autoScale;
    const yMin = Number(settings.yMin);
    const yMax = Number(settings.yMax);
    // Palkin leveys pikseleinä ratkaisee, mahtuuko hinta palkkiin.
    const barPx = width ? (width - 64) / Math.max(1, rows.length) : 0;
    const fs = remPx();
    const perHour = Math.max(1, Math.round(60 / step));
    const plotW = Math.max(100, (width || 600) - fs * 5);
    const everyH = [1, 2, 3, 4, 6, 12, 24].find((h) => (rows.length / (h * perHour)) * fs * 2.6 <= plotW) ?? 24;
    const labelEvery = everyH * perHour;
    const labelMode = barPx >= fs * 2.4 ? 'flat' : barPx >= fs * 1.15 ? 'rotated' : 'none';
    const data = rows.map((r, i) => {
      const v = values[i];
      const cls = classify(r.spot, bands);
      const clipped = fixed && v !== null && (v > yMax || v < yMin);
      return {
        value: v === null ? null : fixed ? Math.min(yMax, Math.max(yMin, v)) : v,
        real: v,
        cls,
        // Todella kalliit palkit vinoviivoitetaan, jotta ne erottuvat myös ilman värinäköä.
        itemStyle: { color: colors[cls], ...(clipped ? { decal: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3] } }
          : cls === 'red' ? { decal: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [3, 4], rotation: -Math.PI / 4, color: 'rgba(255,255,255,0.45)' } } : {}) },
        // Asteikon ylittävän palkin hinta näytetään vain, jos palkkeihin mahtuu tekstiä.
        label: clipped && labelMode !== 'none'
          ? { show: true, position: v > yMax ? 'insideTop' : 'insideBottom', formatter: fmtPrice(v, labelMode === 'flat' ? 1 : 0), color: '#fff', fontSize: 10, rotate: labelMode === 'rotated' ? 90 : 0 }
          : labelMode === 'none' || v === null
            ? { show: false }
            : {
                show: true, position: v < 0 ? 'bottom' : 'top', formatter: fmtPrice(v, 1),
                color: text, fontSize: labelMode === 'flat' ? 11 : 10,
                rotate: labelMode === 'rotated' ? 90 : 0, align: labelMode === 'rotated' ? 'left' : 'center',
                verticalAlign: 'middle', distance: labelMode === 'rotated' ? 4 : 6,
              },
      };
    });
    const bandAreas = [];
    if (bands) {
      const lo = userPrice(bands.low, settings);
      const hi = userPrice(bands.high, settings);
      const red = userPrice(bands.red, settings);
      const top = fixed ? yMax : 1e6;
      bandAreas.push([{ yAxis: lo, itemStyle: { color: colors.green, opacity: 0.13 } }, { yAxis: hi }]);
      bandAreas.push([{ yAxis: hi, itemStyle: { color: colors.yellow, opacity: 0.13 } }, { yAxis: red }]);
      bandAreas.push([{ yAxis: red, itemStyle: { color: colors.red, opacity: 0.1 } }, { yAxis: top }]);
    }
    const nowIdx = rows.findIndex((r) => nowMs >= r.t && nowMs < r.t + step * 60000);
    const markLines = [];
    if (bands) {
      markLines.push({
        yAxis: userPrice(bands.mean, settings),
        lineStyle: { color: colors.green, type: 'dashed', width: 1.5 },
        label: { formatter: 'vuoden ka.', position: 'insideEndTop', color: muted, fontSize: 10 },
      });
    }
    // Vuorokauden vaihde (kun kaaviossa on myös huominen): katkoviiva ja viikonpäivä.
    const midIdx = rows.findIndex((r, i) => i > 0 && hhmm(r.t) === '00:00');
    if (midIdx > 0) {
      markLines.push({
        xAxis: midIdx,
        lineStyle: { color: muted, type: 'dashed', width: 1.5 },
        label: { formatter: weekdayShort(rows[midIdx].t), position: 'end', color: muted },
      });
    }
    if (nowIdx >= 0) {
      markLines.push({
        xAxis: nowIdx,
        lineStyle: { color: css('--now'), type: 'solid', width: 2 },
        label: { formatter: 'nyt', position: 'end', color: css('--now') },
      });
    }
    // --- Laitekerrokset: halvin ja valittu käyttöjakso kaistoina, käyttökerran hinta €-viivana.
    const SLOT = 15 * 60000;
    const nowSlot = nowMs - (nowMs % SLOT);
    const bestWhen = (t) => (weekdayShort(t) === weekdayShort(nowMs) ? hhmm(t) : `${weekdayShort(t)} ${hhmm(t)}`);
    const quarters = step === 15 ? rows : rows.flatMap((h) => h.quarters ?? [h]);
    const idxOf = (t) => rows.findIndex((r) => t >= r.t && t < r.t + step * 60000);
    const ov = overlays.map((o) => {
      const color = css(`--ov${o.slot + 1}`);
      // Halvimmaksi ajaksi vain tulevat aloitukset (kuluvasta vartista alkaen).
      const best = bestStart(o.dev, quarters.map((q) => q.t).filter((t) => t >= nowSlot), costAt);
      const dur = deviceSlotEnergy(o.dev).length * SLOT;
      const line = rows.map((r) => runCost(o.dev, r.t, costAt));
      return { ...o, color, best, dur, line, chosen: runCost(o.dev, o.startMs, costAt) };
    });
    let axisTop = fixed ? yMax : Math.ceil(Math.max(1, ...values.filter((v) => v !== null)) * 1.05);
    const axisBottom = fixed ? yMin : Math.min(0, Math.floor(Math.min(0, ...values.filter((v) => v !== null))));
    // Kaistoille varataan oma tila hinta-asteikon yläpuolelta, jotta ne eivät peitä palkkeja.
    const priceTop = axisTop;
    const laneH = (priceTop - axisBottom) * 0.06;
    if (ov.length) axisTop = priceTop + laneH * (0.5 + 1.35 * ov.length);
    const span = (t, d) => {
      const i0 = idxOf(t);
      if (i0 < 0) return null;
      let i1 = idxOf(t + d - 1);
      if (i1 < 0) i1 = rows.length - 1;
      return [i0, i1];
    };
    // Kaistat piirretään numeeriselle apuakselille (palkin i keskikohta = i), koska luokka-akselin
    // markArea saa kapeilla palkeilla väärän leveyden.
    const laneAreas = [];
    ov.forEach((o, i) => {
      const hi = axisTop - laneH * 0.35 - i * laneH * 1.35;
      const lo = hi - laneH;
      const b = o.best ? span(o.best.t, o.dur) : null;
      if (b) {
        // Nimilappu jakson viereen sille puolelle, jolla on tilaa.
        const rightSide = b[0] < rows.length * 0.55;
        laneAreas.push([{
          xAxis: b[0] - 0.5, yAxis: lo, itemStyle: { color: o.color, opacity: 0.9 },
          label: { show: true, position: rightSide ? 'right' : 'left', distance: 6, color: text, fontWeight: 'bold',
            formatter: screen.narrow ? `halvin ${bestWhen(o.best.t)}` : `${o.dev.name.split(',')[0]}: halvin ${bestWhen(o.best.t)}` },
        }, { xAxis: b[1] + 0.5, yAxis: hi }]);
      }
      const c = span(o.startMs, o.dur);
      if (c) {
        laneAreas.push([{
          xAxis: c[0] - 0.5, yAxis: lo,
          itemStyle: { color: 'rgba(0,0,0,0)', borderColor: o.color, borderWidth: 2, borderType: 'dashed' },
        }, { xAxis: c[1] + 0.5, yAxis: hi }]);
      }
    });
    const hasOv = ov.length > 0;
    const maxCost = Math.max(0.01, ...ov.flatMap((o) => o.line.filter((v) => v !== null)));
    const euroTop = maxCost * 1.08;
    // €-asteikko venytetään niin, että 0 € ja 0 c/kWh ovat samalla korkeudella ja kaistojen tila jää yläpuolelle.
    const euroPerUnit = euroTop / (priceTop || 1);
    const euroRange = { min: axisBottom * euroPerUnit, max: axisTop * euroPerUnit };
    const legendRows = hasOv ? (screen.narrow ? ov.length : 1) : 0;
    const topExtra = legendRows * fs * 1.6;

    return {
      animation: false,
      ...(hasOv ? {
        legend: {
          top: 0, left: screen.narrow ? 0 : 'center', orient: screen.narrow ? 'vertical' : 'horizontal',
          itemWidth: fs * 1.4, textStyle: { color: text }, data: ov.map((o) => o.dev.name),
        },
      } : {}),
      grid: screen.narrow
        ? { left: 2, right: 4, top: topExtra + (labelMode === 'rotated' ? fs * 3.2 : fs * 2.2), bottom: 4, containLabel: true }
        : { left: 8, right: 16, top: topExtra + (labelMode === 'rotated' ? fs * 3.4 : fs * 2.4), bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const p = ps[0];
          const d = data[p.dataIndex];
          const end = hhmm(rows[p.dataIndex].t + step * 60000);
          let html = `${p.name}–${end}<br/><b>${fmtPrice(d.real)} ${unit}</b><br/>${CLASS_LABELS[d.cls]}`;
          if (ov.length) {
            html += `<br/>Käyttökerta, jos aloitus klo ${p.name}:`;
            for (const o of ov) {
              html += `<br/><span style="color:${o.color}">●</span> ${esc(o.dev.name)}: <b>${fmtEur(o.line[p.dataIndex])}</b>`;
            }
          }
          return html;
        },
      },
      xAxis: [{
        type: 'category',
        data: labels,
        axisLabel: {
          color: muted,
          // Merkintöjen väli leveyden mukaan: vähintään ~2,6rem kunkin merkinnän välille.
          interval: (i) => i % labelEvery === 0,
          formatter: (v) => v.slice(-5, -3),
        },
        axisLine: { lineStyle: { color: border } },
        axisTick: { show: false },
      }, { type: 'value', show: false, min: -0.5, max: rows.length - 0.5 }],
      yAxis: [{
        type: 'value',
        min: fixed ? yMin : axisBottom,
        max: axisTop,
        name: unit,
        nameTextStyle: { color: muted, align: 'left' },
        axisLine: { show: false }, axisTick: { show: false },
        // Kaistojen tilan arvoja ei näytetä asteikossa.
        axisLabel: { color: muted, formatter: (v) => (v > priceTop + 1e-9 ? '' : String(v)) },
        splitLine: { lineStyle: { color: border } },
      }, ...(hasOv ? [{
        // Laitteiden käyttökerran hinta: oma asteikko oikealla (pystyakselilla eri yksikkö, siksi nimetty selvästi).
        // Nolla samalle korkeudelle kuin hinta-asteikon nolla.
        type: 'value', position: 'right', name: '€ / käyttökerta', ...euroRange,
        axisLine: { show: false }, axisTick: { show: false },
        nameTextStyle: { color: muted, align: 'right' },
        axisLabel: { color: muted, formatter: (v) => (v < -1e-9 || v > euroTop + 1e-9 ? '' : fmtPrice(v, 2)) }, splitLine: { show: false },
      }] : [])],
      series: [{
        type: 'bar',
        data,
        barCategoryGap: step === 15 ? '10%' : '18%',
        markArea: { silent: true, data: bandAreas },
        markLine: { silent: true, symbol: 'none', data: markLines },
        textStyle: { color: text },
      }, ...(laneAreas.length ? [{
        type: 'scatter', xAxisIndex: 1, yAxisIndex: 0, data: [], silent: true, z: 3,
        markArea: { silent: true, data: laneAreas },
      }] : []), ...ov.map((o) => ({
        name: o.dev.name, type: 'line', yAxisIndex: 1, z: 4, data: o.line,
        showSymbol: false, connectNulls: false, color: o.color,
        lineStyle: { color: o.color, width: 2.5 },
        emphasis: { focus: 'series' },
      }))],
    };
  }

  onMount(() => {
    chart = echarts.init(el, null, { renderer: 'canvas' });
    width = el.clientWidth;
    const ro = new ResizeObserver(() => { width = el.clientWidth; chart.resize(); });
    ro.observe(el);
    return () => { ro.disconnect(); chart.dispose(); };
  });

  $effect(() => {
    // riippuvuudet: rows, settings, bands, nowMs, width, teema
    scheme?.dark;
    const opt = applyFont(buildOption());
    chart?.setOption(opt, true);
  });
</script>

<div class="chart" bind:this={el} role="img" aria-label={label + overlayText}
  style="height: {22 + (overlays.length ? (screen.narrow ? overlays.length * 1.6 : 1.6) : 0)}rem"></div>

<style>
  .chart { width: 100%; }
</style>
