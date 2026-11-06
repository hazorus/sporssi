<script>
  import { echart, cssVar, screen, remPx } from '../lib/chart.svelte.js';
  import { fmtEur, fmtKwh, fmtPrice, esc } from '../lib/pricing.js';

  // parts: [{key, name, kwh, eur, group}] ; group: 'appliance' | 'water' | 'heating'
  let { parts, scheme, note = '' } = $props();

  const MIN_SHARE = 0.01; // alle 1 %:n kodinkoneet yhdistetään

  const total = $derived(parts.reduce((a, p) => a + (p.kwh || 0), 0));
  const rows = $derived.by(() => {
    if (!(total > 0)) return [];
    const big = [];
    const other = { key: 'muut', name: 'Muut kodinkoneet', kwh: 0, eur: 0, group: 'appliance', count: 0 };
    for (const p of parts) {
      if (!(p.kwh > 0)) continue;
      if (p.group === 'appliance' && p.kwh / total < MIN_SHARE) {
        other.kwh += p.kwh; other.eur += p.eur || 0; other.count += 1;
      } else big.push(p);
    }
    if (other.count) big.push({ ...other, name: `Muut kodinkoneet (${other.count})` });
    return big.map((p) => ({ ...p, share: p.kwh / total })).sort((a, b) => b.share - a.share);
  });

  const option = $derived.by(() => {
    scheme.dark;
    const narrow = screen.narrow;
    const fs = remPx();
    const list = [...rows].reverse(); // suurin ylimpänä
    const max = Math.max(0.0001, ...list.map((r) => r.share));
    return {
      animation: false,
      grid: narrow ? { left: 2, right: 2, top: fs * 1.3, bottom: 2 } : { left: 8, right: fs * 1.6, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const r = list[p.dataIndex];
          return `<b>${esc(r.name)}</b><br/>${fmtPrice(r.share * 100, 1)} % vuorokauden kulutuksesta`
            + `<br/>${fmtKwh(r.kwh)} kWh · ${fmtEur(r.eur)}`;
        },
      },
      xAxis: {
        type: 'value', min: 0, max: Math.min(1, Math.ceil(max * 10) / 10),
        axisLabel: { show: !narrow, color: cssVar('--muted'), formatter: (v) => `${Math.round(v * 100)} %` },
        splitLine: { lineStyle: { color: cssVar('--border') } },
      },
      yAxis: {
        type: 'category', data: list.map((r) => r.name),
        axisLabel: narrow
          ? { inside: true, align: 'left', verticalAlign: 'bottom', padding: [0, 0, Math.round(fs * 0.55), 0], color: cssVar('--text') }
          : { color: cssVar('--text') },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: cssVar('--border') } },
        z: 3,
      },
      series: [{
        type: 'bar', barMaxWidth: fs * 1.6, ...(narrow ? { barWidth: Math.round(fs * 0.8) } : {}),
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        data: list.map((r) => {
          const inside = r.share >= max * 0.6;
          return {
            value: r.share,
            itemStyle: { color: cssVar('--accent') },
            label: inside ? { position: 'insideRight', color: '#fff', fontWeight: 'bold' } : { position: 'right', color: cssVar('--text') },
          };
        }),
        label: { show: true, formatter: (p) => `${fmtPrice(list[p.dataIndex].share * 100, list[p.dataIndex].share < 0.1 ? 1 : 0)} %` },
      }],
    };
  });

  const ariaLabel = $derived(`Vuorokauden kulutusjakauma, yhteensä ${fmtKwh(total)} kWh: `
    + rows.map((r) => `${r.name} ${fmtPrice(r.share * 100, 1)} %`).join(', ') + '.');
</script>

{#if rows.length}
  <p class="small muted">Yhteensä {fmtKwh(total)} kWh vuorokaudessa. Alle 1&nbsp;%:n kodinkoneet on yhdistetty.{note ? ` ${note}` : ''}</p>
  <div class="chart" role="img" aria-label={ariaLabel}
    style="height: {Math.max(140, remPx() * (screen.narrow ? 1.6 + rows.length * 3 : 1.5 + rows.length * 2.2))}px"
    use:echart={option}></div>
{:else}
  <p class="muted">Tälle päivälle ei ole kulutustietoja.</p>
{/if}

<style>
  .chart { width: 100%; }
</style>
