// Svelte-action ECharts-kaaviolle: <div use:echart={option}> tai <div use:echart={{ option, setup }}>,
// jossa setup(chart) voi kytkeä tapahtumankäsittelijät. Päivittyy optionin muuttuessa.
import echarts from './echarts.js';

const optionOf = (arg) => (arg && arg.option !== undefined ? arg.option : arg);

export function echart(node, arg) {
  const chart = echarts.init(node);
  const option = optionOf(arg);
  if (option) chart.setOption(option, true);
  if (arg && typeof arg.setup === 'function') arg.setup(chart);
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(node);
  return {
    update(next) { const o = optionOf(next); if (o) chart.setOption(o, true); },
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
