const base = (window.SPORSSI_CONFIG?.apiBase ?? 'api').replace(/\/$/, '');

async function get(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  const url = `${base}/${path}${qs.toString() ? '?' + qs : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ei JSONia */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  prices: (date) => get('prices', { date }),
  stats: () => get('stats'),
  devices: () => get('devices'),
  heatingOptions: () => get('heating/options'),
  heating: (params) => get('heating', params),
};
