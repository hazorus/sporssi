<script>
  import { echart, cssVar, screen, remPx } from '../lib/chart.svelte.js';
  import { fmtEur, fmtKwh, fmtPrice, esc } from '../lib/pricing.js';

  // parts: [{key, name, kwh, eur, group}] ; group: 'appliance' | 'water' | 'heating'
  let { parts, scheme, note = '' } = $props();

  const MIN_SHARE = 0.01; // alle 1 %:n kodinkoneet yhdistetään

  const total = $derived(parts.reduce((a, p) => a + (p.kwh || 0), 0));
  const totalEur = $derived(parts.reduce((a, p) => a + Math.max(0, p.eur || 0), 0));
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
    return big.map((p) => ({ ...p, share: p.kwh / total, costShare: totalEur > 0 ? Math.max(0, p.eur) / totalEur : 0 }))
      .sort((a, b) => b.share - a.share);
  });

  const option = $derived.by(() => {
    scheme.dark;
    const narrow = screen.narrow;
    const fs = remPx();
    const list = [...rows].reverse(); // suurin ylimpänä
    const max = Math.max(0.0001, ...list.map((r) => Math.max(r.share, r.costShare)));
    const text = cssVar('--text');
    const kwhName = 'Osuus kulutuksesta (kWh)';
    const eurName = 'Osuus kustannuksista (€)';
    const pct = (v) => `${fmtPrice(v * 100, v < 0.1 ? 1 : 0)} %`;
    const barLabel = (v) => (v >= max * 0.6
      ? { position: 'insideRight', color: '#fff', fontWeight: 'bold' }
      : { position: 'right', color: text });
    const barW = Math.round(fs * 1.25); // tekstin korkuinen palkki: luvut eivät mene päällekkäin
    return {
      animation: false,
      legend: { top: 0, left: narrow ? 0 : 'center', itemWidth: fs, itemHeight: fs * 0.75, textStyle: { color: cssVar('--muted') }, data: [kwhName, eurName] },
      grid: narrow
        ? { left: 2, right: 2, top: fs * 4, bottom: 2 }
        : { left: 8, right: fs * 1.6, top: fs * 2.2, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const r = list[ps[0].dataIndex];
          return `<b>${esc(r.name)}</b>`
            + `<br/>Kulutus: ${fmtKwh(r.kwh)} kWh (${pct(r.share)})`
            + `<br/>Kustannus: ${fmtEur(r.eur)} (${pct(r.costShare)})`;
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
          ? { inside: true, align: 'left', verticalAlign: 'bottom', padding: [0, 0, Math.round(fs * 1.45), 0], color: text }
          : { color: text },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: cssVar('--border') } },
        z: 3,
      },
      series: [
        {
          name: kwhName, type: 'bar', barWidth: barW, barGap: '12%',
          itemStyle: { color: cssVar('--accent'), borderRadius: [0, 4, 4, 0] },
          data: list.map((r) => ({ value: r.share, label: barLabel(r.share) })),
          label: { show: true, formatter: (p) => pct(list[p.dataIndex].share) },
        },
        {
          name: eurName, type: 'bar', barWidth: barW,
          itemStyle: { color: cssVar('--cost'), borderRadius: [0, 4, 4, 0] },
          data: list.map((r) => ({ value: r.costShare, label: barLabel(r.costShare) })),
          label: { show: true, formatter: (p) => `${pct(list[p.dataIndex].costShare)} · ${fmtEur(list[p.dataIndex].eur)}` },
        },
      ],
    };
  });

  const ariaLabel = $derived(`Vuorokauden kulutusjakauma, yhteensä ${fmtKwh(total)} kWh: `
    + rows.map((r) => `${r.name}: kulutuksesta ${fmtPrice(r.share * 100, 1)} %, kustannuksista ${fmtPrice(r.costShare * 100, 1)} % eli ${fmtEur(r.eur)}`).join('; ') + '.');
</script>

{#if rows.length}
  <p class="small muted">Yhteensä {fmtKwh(total)} kWh vuorokaudessa. Kustannus yhteensä {fmtEur(totalEur)}. Alle 1&nbsp;%:n kodinkoneet on yhdistetty.{note ? ` ${note}` : ''}</p>
  <div class="chart" role="img" aria-label={ariaLabel}
    style="height: {Math.max(160, remPx() * (screen.narrow ? 4.4 + rows.length * 5 : 3.5 + rows.length * 3.6))}px"
    use:echart={option}></div>
{:else}
  <p class="muted">Tälle päivälle ei ole kulutustietoja.</p>
{/if}

<style>
  .chart { width: 100%; }
</style>
