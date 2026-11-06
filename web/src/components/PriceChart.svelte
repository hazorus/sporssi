<script>
  import { onMount } from 'svelte';
  import echarts from '../lib/echarts.js';
  import { screen, applyFont, remPx } from '../lib/chart.svelte.js';
  import { classify, userPrice, hhmm, CLASS_LABELS, fmtPrice } from '../lib/pricing.js';

  let { rows, settings, bands, nowMs, unit, scheme, label = 'Pörssisähkön hintakaavio' } = $props();
  let width = $state(0);
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
    const step = rows.length > 30 ? 15 : 60;
    const labels = rows.map((r) => hhmm(r.t));
    const values = rows.map((r) => userPrice(r.spot, settings));
    const fixed = !settings.autoScale;
    const yMin = Number(settings.yMin);
    const yMax = Number(settings.yMax);
    // Palkin leveys pikseleinä ratkaisee, mahtuuko hinta palkkiin.
    const barPx = width ? (width - 64) / Math.max(1, rows.length) : 0;
    const fs = remPx();
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
        label: clipped
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
    if (nowIdx >= 0) {
      markLines.push({
        xAxis: nowIdx,
        lineStyle: { color: css('--now'), type: 'solid', width: 2 },
        label: { formatter: 'nyt', position: 'end', color: css('--now') },
      });
    }
    return {
      animation: false,
      grid: screen.narrow
        ? { left: 2, right: 4, top: labelMode === 'rotated' ? fs * 3.2 : fs * 2.2, bottom: 4, containLabel: true }
        : { left: 8, right: 16, top: labelMode === 'rotated' ? fs * 3.4 : fs * 2.4, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const p = ps[0];
          const d = data[p.dataIndex];
          const end = hhmm(rows[p.dataIndex].t + step * 60000);
          return `${p.name}–${end}<br/><b>${fmtPrice(d.real)} ${unit}</b><br/>${CLASS_LABELS[d.cls]}`;
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: muted,
          interval: step === 15 ? (i) => i % 8 === 0 : (i) => i % 2 === 0,
          formatter: (v) => v.slice(0, 2),
        },
        axisLine: { lineStyle: { color: border } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: fixed ? yMin : (v) => Math.min(0, Math.floor(v.min)),
        max: fixed ? yMax : (v) => Math.ceil(v.max * 1.05),
        name: unit,
        nameTextStyle: { color: muted, align: 'left' },
        axisLabel: { color: muted },
        splitLine: { lineStyle: { color: border } },
      },
      series: [{
        type: 'bar',
        data,
        barCategoryGap: step === 15 ? '10%' : '18%',
        markArea: { silent: true, data: bandAreas },
        markLine: { silent: true, symbol: 'none', data: markLines },
        textStyle: { color: text },
      }],
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

<div class="chart" bind:this={el} role="img" aria-label={label}></div>

<style>
  .chart { width: 100%; height: 22rem; }
</style>
