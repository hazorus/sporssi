// Hintojen muunnokset, luokittelu ja koostaminen. Ei riippuvuuksia (testattavissa nodella).

export const TZ = 'Europe/Helsinki';
export const SLOT_MS = 15 * 60 * 1000;

export const DEFAULT_SETTINGS = {
  priceMode: 'consumer', // 'spot' = pelkkä pörssihinta ALV 0 %, 'consumer' = sis. ALV + lisät
  vat: 25.5, // %
  margin: 0.49, // myyjän marginaali c/kWh (sis. ALV)
  transfer: 0, // siirtohinta c/kWh (sis. ALV)
  includeTax: false,
  tax: 2.827, // sähkövero + huoltovarmuusmaksu, luokka I, c/kWh sis. ALV
  resolution: 'hour', // 'hour' | 'quarter'
  autoScale: false,
  yMin: -5,
  yMax: 40,
  bandK1: 1, // vihreä alue: keskihinta ± k1 · hajonta
  bandK2: 2, // punainen: yli keskihinta + k2 · hajonta
};

// Spot-hinta (c/kWh, ALV 0) -> käyttäjälle näytettävä hinta. Negatiiviseen hintaan ei lisätä ALV:tä.
export function userPrice(spot, s) {
  if (spot === null || spot === undefined) return null;
  if (s.priceMode === 'spot') return spot;
  const withVat = spot > 0 ? spot * (1 + s.vat / 100) : spot;
  return withVat + s.margin + s.transfer + (s.includeTax ? s.tax : 0);
}

export function bands(stats, s) {
  if (!stats) return null;
  return {
    mean: stats.mean,
    low: stats.mean - s.bandK1 * stats.std,
    high: stats.mean + s.bandK1 * stats.std,
    red: stats.mean + s.bandK2 * stats.std,
  };
}

// Luokitellaan aina spot-hinnan perusteella, jotta värit eivät riipu lisistä.
export function classify(spot, b) {
  if (spot === null || spot === undefined || !b) return 'none';
  if (spot > b.red) return 'red';
  if (spot > b.high) return 'yellow';
  if (spot < b.low) return 'cheap';
  return 'green';
}

export const CLASS_LABELS = {
  cheap: 'Erittäin halpa',
  green: 'Tavanomainen',
  yellow: 'Kallis',
  red: 'Todella kallis',
  none: 'Ei tietoa',
};

const timeFmt = new Intl.DateTimeFormat('fi-FI', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});
const dayFmt = new Intl.DateTimeFormat('fi-FI', {
  timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric',
});
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function hhmm(ms) {
  return timeFmt.format(new Date(ms)).replace('.', ':');
}

export function dayLabel(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const text = dayFmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function localDate(ms) {
  return partsFmt.format(new Date(ms)); // VVVV-KK-PP
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

// API:n slotit -> [{t, spot}] millisekunteina.
export function normalizeSlots(apiSlots) {
  return apiSlots.map((s) => ({ t: Date.parse(s.start), spot: s.price }));
}

// Yhdistää 15 min jaksot tunneiksi (aikapainotettu keskiarvo). Puuttuva vartti -> null.
export function toHours(slots) {
  const out = [];
  for (let i = 0; i < slots.length; i += 4) {
    const group = slots.slice(i, i + 4);
    const vals = group.map((g) => g.spot);
    const spot = vals.some((v) => v === null) ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
    out.push({ t: group[0].t, spot, quarters: group });
  }
  return out;
}

export function fmtPrice(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  return v.toLocaleString('fi-FI', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtEur(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  // Kustannukset sentin tarkkuudella. -0,00 näytetään 0,00:na.
  const r = Math.round(v * 100) / 100;
  return (r === 0 ? 0 : r).toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export function fmtKwh(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const digits = v !== 0 && Math.abs(v) < 0.1 ? 3 : 2;
  return v.toLocaleString('fi-FI', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const wdFmt = new Intl.DateTimeFormat('fi-FI', { timeZone: TZ, weekday: 'short' });
export function weekdayShort(ms) {
  return wdFmt.format(new Date(ms));
}

// Suomen paikallinen aika (VVVV-KK-PP, tunti, minuutti) -> UTC ms. Huomioi kesäajan.
export function helsinkiToUtc(isoDate, h = 0, m = 0) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  let t = Date.UTC(y, mo - 1, d, h, m);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    t += Date.UTC(y, mo - 1, d, h, m) - shown;
  }
  return t;
}
