// Laitteiden kulutuksen jakaminen 15 min jaksoille ja kustannuslaskenta.

import { SLOT_MS, TZ } from './pricing.js';

export const SLOTS_PER_DAY = 96;

// Laitteen energia yhdellä käyttökerralla (continuous: vuorokaudessa), kWh.
export function deviceEnergy(dev) {
  if (dev.kind === 'cycle') return Number(dev.energy_kwh) || 0;
  if (dev.kind === 'power') return ((Number(dev.power_kw) || 0) * (Number(dev.duration_min) || 0)) / 60;
  if (dev.kind === 'continuous') return (Number(dev.annual_kwh) || 0) / 365;
  return 0;
}

// Käyttökerran energia jaettuna 15 min jaksoille. Lyhyt käyttö (esim. vedenkeitin 3 min)
// mahtuu yhteen jaksoon. Profiili (suhteelliset painot) venytetään jaksojen määrään.
export function deviceSlotEnergy(dev) {
  const total = deviceEnergy(dev);
  const n = Math.max(1, Math.ceil((Number(dev.duration_min) || 0) / 15));
  let weights;
  if (Array.isArray(dev.profile) && dev.profile.length > 0) {
    const p = dev.profile;
    weights = Array.from({ length: n }, (_, i) => p[Math.min(p.length - 1, Math.floor((i * p.length) / n))]);
  } else {
    // Viimeinen jakso voi olla vajaa: painotetaan käyttöminuuttien mukaan.
    const minutes = Number(dev.duration_min) || 15;
    weights = Array.from({ length: n }, (_, i) => Math.min(15, minutes - i * 15));
  }
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => (total * w) / sum);
}

// Kustannus, jos laite käynnistetään hetkellä startMs. priceAt(t) -> c/kWh tai null.
export function runCost(dev, startMs, priceAt) {
  const parts = deviceSlotEnergy(dev);
  let eur = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = priceAt(startMs + i * SLOT_MS);
    if (p === null || p === undefined) return null;
    eur += (parts[i] * p) / 100;
  }
  return eur;
}

// Halvin aloitushetki annetuista ehdokkaista (koko käytön hinnat oltava tiedossa).
export function bestStart(dev, candidates, priceAt) {
  let best = null;
  for (const t of candidates) {
    const c = runCost(dev, t, priceAt);
    if (c === null) continue;
    if (!best || c < best.eur - 1e-9) best = { t, eur: c };
  }
  return best;
}

// Paikallinen "HH:MM" annetulle päivälle -> UTC ms. Etsitään päivän sloteista.
export function startMsFor(daySlots, hhmmText, hhmmOf) {
  const target = (hhmmText || '00:00').slice(0, 5);
  const [h, m] = target.split(':').map(Number);
  const rounded = `${String(h).padStart(2, '0')}:${String(Math.floor(m / 15) * 15).padStart(2, '0')}`;
  const hit = daySlots.find((s) => hhmmOf(s.t) === rounded);
  return hit ? hit.t : daySlots[0]?.t;
}

// Aikataulu: jokaiselle päivän slotille kunkin laitteen kWh ja €.
// devices: [{key, dev, startMs}] ; continuous-laitteet jaetaan tasaisesti koko päivälle.
// extra: [{key, kwhAt(t)}] esim. lämmitys.
export function schedule(daySlots, devices, priceAt, extra = []) {
  const rows = daySlots.map((s) => ({ t: s.t, price: priceAt(s.t), cells: {} }));
  const index = new Map(rows.map((r, i) => [r.t, i]));
  const totals = {};
  const newTotal = () => ({ kwh: 0, eur: 0, outside: 0, unknown: false });
  for (const { key, dev, startMs } of devices) {
    totals[key] ??= newTotal();
    if (dev.kind === 'continuous') {
      const perSlot = deviceEnergy(dev) / daySlots.length;
      for (const r of rows) add(r, key, perSlot);
      continue;
    }
    const parts = deviceSlotEnergy(dev);
    parts.forEach((kwh, i) => {
      const t = startMs + i * SLOT_MS;
      const idx = index.get(t);
      if (idx === undefined) {
        // Käyttö jatkuu seuraavalle vuorokaudelle: lasketaan laitteen kokonaissummaan.
        totals[key].outside += kwh;
        totals[key].kwh += kwh;
        const p = priceAt(t);
        if (p === null || p === undefined) totals[key].unknown = true;
        else totals[key].eur += (kwh * p) / 100;
      } else add(rows[idx], key, kwh);
    });
  }
  for (const { key, kwhAt } of extra) {
    totals[key] ??= newTotal();
    for (const r of rows) {
      const kwh = kwhAt(r.t);
      if (kwh === null || kwh === undefined) {
        totals[key].unknown = true;
        r.cells[key] = { kwh: null, eur: null };
      } else add(r, key, kwh);
    }
  }
  function add(r, key, kwh) {
    const eur = r.price === null || r.price === undefined ? null : (kwh * r.price) / 100;
    const c = r.cells[key];
    if (!c) r.cells[key] = { kwh, eur };
    else if (c.kwh !== null) {
      c.kwh += kwh;
      c.eur = c.eur === null || eur === null ? null : c.eur + eur;
    }
    totals[key].kwh += kwh;
    if (eur === null) totals[key].unknown = true;
    else totals[key].eur += eur;
  }
  for (const r of rows) {
    let kwh = 0;
    let eur = 0;
    let unknown = false;
    for (const c of Object.values(r.cells)) {
      if (c.kwh === null) { unknown = true; continue; }
      kwh += c.kwh;
      if (c.eur === null) unknown = true;
      else eur += c.eur;
    }
    r.total = { kwh, eur: unknown ? null : eur };
  }
  return { rows, totals };
}

// Neljän vartin rivit tunneiksi.
export function scheduleToHours(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 4) {
    const g = rows.slice(i, i + 4);
    const cells = {};
    for (const r of g) {
      for (const [k, c] of Object.entries(r.cells)) {
        const acc = (cells[k] ??= { kwh: 0, eur: 0 });
        acc.kwh = acc.kwh === null || c.kwh === null ? null : acc.kwh + c.kwh;
        acc.eur = acc.eur === null || c.eur === null ? null : acc.eur + c.eur;
      }
    }
    const prices = g.map((r) => r.price);
    const price = prices.some((p) => p === null || p === undefined)
      ? null : prices.reduce((a, b) => a + b, 0) / prices.length;
    const kwh = g.reduce((a, r) => a + r.total.kwh, 0);
    const eur = g.some((r) => r.total.eur === null) ? null : g.reduce((a, r) => a + r.total.eur, 0);
    out.push({ t: g[0].t, price, cells, total: { kwh, eur } });
  }
  return out;
}

export { TZ };
