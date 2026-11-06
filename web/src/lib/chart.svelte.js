// Svelte-action ECharts-kaaviolle: <div use:echart={option}> tai <div use:echart={{ option, setup }}>,
// jossa setup(chart) voi kytkeä tapahtumankäsittelijät. Päivittyy optionin muuttuessa.
import echarts from './echarts.js';

const optionOf = (arg) => (arg && arg.option !== undefined ? arg.option : arg);

export function echart(node, arg) {
  const chart = echarts.init(node);
  const option = optionOf(arg);
  if (option) chart.setOption(applyFont(option), true);
  if (arg && typeof arg.setup === 'function') arg.setup(chart);
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(node);
  return {
    update(next) { const o = optionOf(next); if (o) chart.setOption(applyFont(o), true); },
    destroy() { ro.disconnect(); chart.dispose(); },
  };
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Tummaa ja vaaleaa teemaa seuraava tila: kaaviot piirretään uudelleen teeman vaihtuessa.
export function colorScheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  let dark = $state(mq.matches);
  mq.addEventListener('change', (e) => { dark = e.matches; });
  return { get dark() { return dark; } };
}

// Kapea näyttö (puhelin): kaaviot käyttävät pienempiä marginaaleja ja eri asettelua.
const mqNarrow = typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)') : null;
let narrowState = $state(mqNarrow?.matches ?? false);
mqNarrow?.addEventListener('change', (e) => { narrowState = e.matches; });
export const screen = { get narrow() { return narrowState; } };

// Kaavioiden tekstit samassa koossa kuin sivun perusteksti (1rem).
export function remPx() {
  if (typeof document === 'undefined') return 16;
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

const TEXT_KEYS = new Set(['axisLabel', 'nameTextStyle', 'label', 'textStyle', 'endLabel', 'pageTextStyle']);

// Asettaa fontSize = 1rem kaikkiin option tekstityyleihin (myös data-alkioiden label ja rich-tyylit).
export function applyFont(option, fs = remPx()) {
  const seen = new WeakSet();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (TEXT_KEYS.has(k)) v.fontSize = fs;
        if (k === 'rich') for (const r of Object.values(v)) if (r && typeof r === 'object') r.fontSize = fs;
      }
      walk(v);
    }
  };
  walk(option);
  if (option.tooltip) option.tooltip.textStyle = { ...(option.tooltip.textStyle || {}), fontSize: fs };
  for (const lg of [].concat(option.legend || [])) {
    lg.pageTextStyle = { ...(lg.pageTextStyle || {}), fontSize: fs };
    lg.pageIconSize = Math.round(fs * 0.8);
  }
  return option;
}
