// Oman sähkönkulutuksen tuonti (Datahubin CSV tai muu aika;kulutus-tiedosto) ja analyysi.
// Kaikki käsittely tapahtuu selaimessa; palvelimelta haetaan vain hintahistoria.

import { helsinkiToUtc, localDate, userPrice, TZ } from './pricing.js';

const HOUR = 3600000;
const QUARTER = 900000;

function splitLine(line, delim) {
  // Yksinkertainen CSV-rivi: lainausmerkit sallitaan kenttien ympärillä.
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === delim && !quoted) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function findCol(header, re, exclude = []) {
  return header.findIndex((h, i) => !exclude.includes(i) && re.test(h));
}

// Aika -> UTC ms. ISO-aika ilman aikavyöhykettä tulkitaan UTC:ksi (Datahub) tai Suomen ajaksi.
export function parseTime(text, naiveIsUtc) {
  const s = text.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    if (m[7]) return Date.parse(s.replace(' ', 'T'));
    const [y, mo, d, h, mi] = [m[1], m[2], m[3], +m[4], +m[5]];
    if (naiveIsUtc) return Date.UTC(+y, +mo - 1, +d, h, mi);
    return helsinkiToUtc(`${y}-${mo}-${d}`, h, mi);
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(?:klo\s+)?(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?)?$/i);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const h = m[4] ? +m[4] : 0;
    const mi = m[5] ? +m[5] : 0;
    return naiveIsUtc ? Date.UTC(+m[3], +m[2] - 1, +m[1], h, mi) : helsinkiToUtc(iso, h, mi);
  }
  return NaN;
}

function parseNumber(text) {
  const s = text.replace(/\s/g, '').replace(',', '.');
  if (s === '') return NaN;
  return Number(s);
}

/**
 * Jäsentää kulutustiedoston. Palauttaa { points: [{t, kwh, min}], format, resolutionMin,
 * estimated, skipped, readingType } tai heittää virheen selkeällä viestillä.
 */
export function parseConsumptionCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new Error('Tiedostossa ei ole riittävästi rivejä.');
  // Otsikkorivi: ensimmäinen rivi, jossa on aika- ja kulutussarakkeelta näyttävät nimet.
  let headerIdx = -1;
  let delim = ';';
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    for (const d of [';', ',', '\t']) {
      const cols = splitLine(lines[i], d).map((c) => c.toLowerCase());
      if (cols.length < 2) continue;
      const hasTime = cols.some((c) => /alkuaika|aikaleima|^aika|time|date|päivä|start/.test(c));
      const hasValue = cols.some((c) => /määrä|maara|kulutus|quantity|kwh|energia|value|consumption/.test(c));
      if (hasTime && hasValue) { headerIdx = i; delim = d; break; }
    }
    if (headerIdx >= 0) break;
  }
  if (headerIdx < 0) throw new Error('Tiedostosta ei löytynyt aika- ja kulutussarakkeita (esim. "Alkuaika" ja "Määrä").');
  const header = splitLine(lines[headerIdx], delim).map((c) => c.toLowerCase());
  const iTime = findCol(header, /alkuaika|aikaleima|^aika|start|time|date|päivä/);
  const iValue = findCol(header, /määrä|maara|quantity|kulutus|consumption|energia|kwh|value/, [iTime]);
  const iRes = findCol(header, /resoluutio|resolution|aika-askel/);
  const iUnit = findCol(header, /yksikk|unit/);
  const iType = findCol(header, /lukeman tyyppi|reading type/);
  const iQuality = findCol(header, /laatu|quality|status/);
  // Datahubin tiedosto on joko suomen- tai englanninkielisin otsikoin (Alkuaika / Start Time).
  const isDatahub = (header.includes('alkuaika') || header.includes('start time') || header.some((h) => /meteringpoint|mittauspiste/.test(h)))
    && (iRes >= 0 || iType >= 0);
  const valueIsWh = /\bwh\b/.test(header[iValue]) && !/kwh/.test(header[iValue]);

  const raw = [];
  let skipped = 0;
  for (const line of lines.slice(headerIdx + 1)) {
    const c = splitLine(line, delim);
    if (c.length <= Math.max(iTime, iValue)) { skipped++; continue; }
    const t = parseTime(c[iTime], isDatahub);
    let kwh = parseNumber(c[iValue]);
    if (!Number.isFinite(t) || !Number.isFinite(kwh)) { skipped++; continue; }
    const unit = iUnit >= 0 ? (c[iUnit] || '').toLowerCase() : '';
    if (valueIsWh || unit === 'wh') kwh /= 1000;
    const res = iRes >= 0 ? (c[iRes] || '').toUpperCase() : '';
    raw.push({
      t, kwh,
      min: res === 'PT15M' ? 15 : res === 'PT1H' || res === 'PT60M' ? 60 : 0,
      type: iType >= 0 ? (c[iType] || '').toUpperCase() : '',
      ok: iQuality < 0 || /^(ok|mitattu|measured|valid)$/i.test(c[iQuality] || 'ok'),
    });
  }
  if (!raw.length) throw new Error('Tiedostosta ei saatu luettua yhtään kulutusriviä.');
  // Useita lukematyyppejä (BN01 mitattu, BN02 netotettu ...): käytetään mitattua.
  const types = new Set(raw.map((r) => r.type).filter(Boolean));
  const readingType = types.has('BN01') ? 'BN01' : [...types][0] ?? '';
  let rows = readingType ? raw.filter((r) => r.type === readingType || !r.type) : raw;
  // Resoluutio: sarakkeesta tai aikaleimojen välistä.
  rows.sort((a, b) => a.t - b.t);
  const diffs = [];
  for (let i = 1; i < Math.min(rows.length, 500); i++) if (rows[i].t > rows[i - 1].t) diffs.push(rows[i].t - rows[i - 1].t);
  diffs.sort((a, b) => a - b);
  const inferred = diffs.length && diffs[Math.floor(diffs.length / 2)] <= QUARTER ? 15 : 60;
  for (const r of rows) if (!r.min) r.min = inferred;
  // Päällekkäiset: varttitieto voittaa tuntitiedon, saman ajan viimeinen rivi voittaa.
  const quarterHours = new Set(rows.filter((r) => r.min === 15).map((r) => r.t - (r.t % HOUR)));
  const byKey = new Map();
  for (const r of rows) {
    if (r.min === 60 && quarterHours.has(r.t)) continue;
    byKey.set(`${r.t}:${r.min}`, r);
  }
  rows = [...byKey.values()].sort((a, b) => a.t - b.t);
  return {
    points: rows.map((r) => ({ t: r.t, kwh: r.kwh, min: r.min, est: !r.ok })),
    format: isDatahub ? 'datahub' : 'yleinen',
    resolutionMin: rows.some((r) => r.min === 15) ? 15 : 60,
    estimated: rows.filter((r) => !r.ok).length,
    skipped,
    readingType,
  };
}

// --- Analyysi ---------------------------------------------------------------------------------

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
export function localHour(t) {
  return Number(hourFmt.format(new Date(t))) % 24;
}

/**
 * Yhdistää kulutuksen ja hinnat. spotAt(t) -> c/kWh ALV 0 vartille, joka alkaa t:ssä (tai null).
 * Palauttaa rivit {t, min, kwh, spot, price, eur} (price = kuluttajan energiahinta c/kWh).
 */
export function joinPrices(points, spotAt, settings) {
  const out = [];
  let missing = 0;
  for (const p of points) {
    const n = p.min / 15;
    let sum = 0;
    let ok = true;
    for (let i = 0; i < n; i++) {
      const s = spotAt(p.t + i * QUARTER);
      if (s === null || s === undefined) { ok = false; break; }
      sum += s;
    }
    if (!ok) { missing++; continue; }
    const spot = sum / n;
    // Kuluttajan energiahinta: ALV + marginaali (ilman siirtoa ja veroa: kiinteähintaisessakin ne maksetaan erikseen).
    const price = userPrice(spot, { ...settings, priceMode: 'consumer', transfer: 0, includeTax: false });
    out.push({ t: p.t, min: p.min, kwh: p.kwh, spot, price, eur: (p.kwh * price) / 100 });
  }
  return { rows: out, missing };
}

function sum(arr, f) { let s = 0; for (const x of arr) s += f(x); return s; }

/** Peruskulutus: yöllisten tuntien (klo 1–5) kulutuksen 20 %:n persentiili, wattia. */
export function estimateBaseW(rows) {
  const hourly = new Map();
  for (const r of rows) {
    const h = r.t - (r.t % HOUR);
    hourly.set(h, (hourly.get(h) ?? 0) + r.kwh);
  }
  const night = [...hourly.entries()].filter(([t]) => { const h = localHour(t); return h >= 1 && h < 5; }).map(([, v]) => v);
  if (night.length < 24) return null;
  night.sort((a, b) => a - b);
  return Math.round(night[Math.floor(night.length * 0.2)] * 1000);
}

/**
 * Analyysi aikaväliltä [from, to). opts: { fixedPrice c/kWh, shiftShare 0–1, baseW }
 */
export function analyze(rows, from, to, opts) {
  const sel = rows.filter((r) => r.t >= from && r.t < to);
  if (!sel.length) return null;
  const kwh = sum(sel, (r) => r.kwh);
  const spotCost = sum(sel, (r) => r.eur);
  const fixedCost = (kwh * opts.fixedPrice) / 100;
  // Päivittäin: kulutus, kustannus, päivän keskihinta (aikapainotettu) ja halvimmat tunnit.
  const days = new Map();
  for (const r of sel) {
    const d = localDate(r.t);
    const day = days.get(d) ?? { date: d, kwh: 0, eur: 0, rows: [] };
    day.kwh += r.kwh; day.eur += r.eur; day.rows.push(r);
    days.set(d, day);
  }
  const dayList = [...days.values()];
  // Siirtopotentiaali: peruskulutuksen ylittävä (joustava) osa; siirretään osuus päivän neljälle
  // halvimmalle tunnille (sama vuorokausi, hinnat tiedetään edellisenä päivänä).
  const baseKwhPerMin = Math.max(0, opts.baseW || 0) / 1000 / 60;
  let flexKwh = 0;
  let saving = 0;
  for (const day of dayList) {
    const hourPrice = new Map();
    for (const r of day.rows) {
      const h = r.t - (r.t % HOUR);
      const e = hourPrice.get(h) ?? { p: 0, n: 0 };
      e.p += r.price * r.min; e.n += r.min;
      hourPrice.set(h, e);
    }
    const prices = [...hourPrice.values()].map((e) => e.p / e.n).sort((a, b) => a - b);
    const cheap = prices.slice(0, Math.min(4, prices.length));
    const cheapAvg = cheap.reduce((a, b) => a + b, 0) / (cheap.length || 1);
    day.avgPrice = prices.reduce((a, b) => a + b, 0) / (prices.length || 1);
    day.cheapAvg = cheapAvg;
    for (const r of day.rows) {
      const flex = Math.max(0, r.kwh - baseKwhPerMin * r.min);
      flexKwh += flex;
      saving += (opts.shiftShare * flex * Math.max(0, r.price - cheapAvg)) / 100;
    }
  }
  // Vuorokausiprofiili: keskimääräinen kulutus ja hinta tunneittain.
  const prof = Array.from({ length: 24 }, () => ({ kwh: 0, priceSum: 0, priceN: 0 }));
  for (const r of sel) {
    const h = localHour(r.t);
    prof[h].kwh += r.kwh;
    prof[h].priceSum += r.price * r.min; prof[h].priceN += r.min;
  }
  const nDays = dayList.length;
  const profile = prof.map((p, h) => ({ hour: h, kwhPerDay: p.kwh / nDays, price: p.priceN ? p.priceSum / p.priceN : null, share: p.kwh / kwh }));
  // Kalleimmat tunnit ja päivät.
  const hourly = new Map();
  for (const r of sel) {
    const h = r.t - (r.t % HOUR);
    const e = hourly.get(h) ?? { t: h, kwh: 0, eur: 0 };
    e.kwh += r.kwh; e.eur += r.eur;
    hourly.set(h, e);
  }
  const topHours = [...hourly.values()].map((e) => ({ ...e, price: e.kwh ? (e.eur * 100) / e.kwh : 0 }))
    .sort((a, b) => b.eur - a.eur).slice(0, 10);
  const topDays = [...dayList].sort((a, b) => b.eur - a.eur).slice(0, 5)
    .map((d) => ({ date: d.date, kwh: d.kwh, eur: d.eur, price: d.kwh ? (d.eur * 100) / d.kwh : 0, avgPrice: d.avgPrice }));
  // Ajallinen keskihinta (mitä keskimäärin "olisi maksanut tasaisella kulutuksella").
  const timeAvg = sum(dayList, (d) => d.avgPrice) / (nDays || 1);
  return {
    from, to, nDays, kwh, spotCost, fixedCost,
    paidAvg: kwh ? (spotCost * 100) / kwh : 0, timeAvg,
    flexKwh, saving,
    profile, topHours, topDays,
    days: dayList.map((d) => ({ date: d.date, kwh: d.kwh, eur: d.eur })),
  };
}

/** Vinkit analyysin perusteella (lyhyet suomenkieliset lauseet). */
export function tips(a, opts) {
  const out = [];
  if (!a) return out;
  const prof = a.profile.filter((p) => p.price !== null);
  // Kalleimmat 4 tuntia keskimäärin ja niiden osuus kulutuksesta.
  const byPrice = [...prof].sort((x, y) => y.price - x.price);
  const exp = byPrice.slice(0, 4).sort((x, y) => x.hour - y.hour);
  const cheap = byPrice.slice(-4).sort((x, y) => x.hour - y.hour);
  const expShare = exp.reduce((s, p) => s + p.share, 0);
  const span = (list) => list.map((p) => `${String(p.hour).padStart(2, '0')}`).join(', ');
  out.push(`Kalleimmat tunnit ovat olleet keskimäärin klo ${span(exp)} ja halvimmat klo ${span(cheap)}.`);
  if (expShare > 4 / 24 * 1.15) {
    out.push(`Kulutuksestasi ${Math.round(expShare * 100)} % on osunut kalleimmille tunneille (tasaisella kulutuksella osuus olisi ${Math.round(400 / 24)} %). Siirrä joustavaa käyttöä, kuten pyykin- ja astianpesua, saunaa tai auton latausta, halvimmille tunneille.`);
  } else {
    out.push(`Vain ${Math.round(expShare * 100)} % kulutuksestasi on osunut kalleimmille tunneille – kulutuksesi ajoittuu jo kohtuullisen hyvin.`);
  }
  const ratio = a.timeAvg ? a.paidAvg / a.timeAvg : 1;
  if (ratio > 1.05) out.push(`Maksamasi keskihinta (${a.paidAvg.toFixed(2).replace('.', ',')} c/kWh) on ${Math.round((ratio - 1) * 100)} % korkeampi kuin jakson tasainen keskihinta: kulutuksesi painottuu kalliimpiin tunteihin.`);
  else if (ratio < 0.95) out.push(`Maksamasi keskihinta on ${Math.round((1 - ratio) * 100)} % jakson tasaista keskihintaa alempi: ajoitat kulutustasi jo halvoille tunneille.`);
  if (opts.baseW && opts.baseW > 120) out.push(`Mitattu peruskulutuksesi on noin ${opts.baseW} W (${(opts.baseW * 24 / 1000).toFixed(1).replace('.', ',')} kWh/vrk). Tyypillinen kerrostaloasunto on 40–80 W ja omakotitalo 130–220 W ilman lämmitystä; tarkista vanhat kylmälaitteet, lattialämmitys ja jatkuvasti päällä olevat laitteet.`);
  if (a.saving > 0.5) out.push(`Siirtämällä ${Math.round(opts.shiftShare * 100)} % peruskulutuksen ylittävästä kulutuksesta saman päivän halvimmille tunneille olisit säästänyt noin ${a.saving.toFixed(2).replace('.', ',')} €.`);
  const diff = a.fixedCost - a.spotCost;
  if (Math.abs(diff) > 0.5) out.push(diff > 0
    ? `Pörssisähkö on ollut tällä jaksolla ${diff.toFixed(2).replace('.', ',')} € edullisempi kuin ${opts.fixedPrice.toString().replace('.', ',')} c/kWh kiinteä hinta.`
    : `Kiinteä ${opts.fixedPrice.toString().replace('.', ',')} c/kWh hinta olisi ollut tällä jaksolla ${(-diff).toFixed(2).replace('.', ',')} € edullisempi kuin pörssisähkö.`);
  return out;
}
