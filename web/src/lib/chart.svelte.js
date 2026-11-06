// Svelte-action ECharts-kaaviolle: <div use:echart={option}>. Päivittyy optionin muuttuessa.
import echarts from './echarts.js';

export function echart(node, option) {
  const chart = echarts.init(node);
  if (option) chart.setOption(option, true);
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(node);
  return {
    update(next) { if (next) chart.setOption(next, true); },
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
