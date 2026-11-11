import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConsumptionCsv, parseTime, joinPrices, analyze, estimateBaseW } from './consumption.js';
import { DEFAULT_SETTINGS } from './pricing.js';

const DATAHUB = `Mittauspisteen tunnus;Tuotteen tyyppi;Resoluutio;Yksikkötyyppi;Lukeman tyyppi;Alkuaika;Määrä;Laatu
643000000000000000;8716867000030;PT1H;kWh;BN01;2026-01-15T00:00:00Z;0,512;OK
643000000000000000;8716867000030;PT1H;kWh;BN01;2026-01-15T01:00:00Z;0,488;OK
643000000000000000;8716867000030;PT1H;kWh;BN02;2026-01-15T01:00:00Z;9,999;OK
643000000000000000;8716867000030;PT1H;kWh;BN01;2026-01-15T02:00:00Z;1.25;Estimated
`;

test('Datahub-CSV: puolipiste, desimaalipilkku ja -piste, UTC, BN01', () => {
  const r = parseConsumptionCsv(DATAHUB);
  assert.equal(r.format, 'datahub');
  assert.equal(r.readingType, 'BN01');
  assert.equal(r.points.length, 3);
  assert.equal(r.points[0].t, Date.parse('2026-01-15T00:00:00Z'));
  assert.equal(r.points[1].kwh, 0.488);
  assert.equal(r.points[2].kwh, 1.25);
  assert.equal(r.estimated, 1);
  assert.equal(r.resolutionMin, 60);
});

test('yleinen CSV: suomalainen aika paikallisena aikana, Wh', () => {
  const r = parseConsumptionCsv('Aika;Kulutus (Wh)\n15.1.2026 0:00;500\n15.1.2026 0:15;250\n');
  assert.equal(r.format, 'yleinen');
  assert.equal(r.points[0].t, Date.parse('2026-01-14T22:00:00Z')); // talviaika UTC+2
  assert.equal(r.points[0].kwh, 0.5);
  assert.equal(r.resolutionMin, 15);
  assert.equal(parseTime('2026-07-01T12:00', false), Date.parse('2026-07-01T09:00:00Z'));
});

test('Datahub-CSV englanninkielisin otsikoin (BOM, EST-laatu, tunti + vartti)', () => {
  const csv = '\uFEFFMeteringPointGSRN;Product Type;Resolution;Unit Type;Reading Type;Start Time;Quantity;Quality\n'
    + '643;8716867000030;PT1H;kWh;BN01;2026-07-08T20:00:00Z;0,080000;OK\n'
    + '643;8716867000030;PT1H;kWh;BN01;2026-07-08T21:00:00Z;0,100000;EST\n'
    + '643;8716867000030;PT15M;kWh;BN01;2026-07-08T21:00:00Z;0,020000;OK\n'
    + '643;8716867000030;PT15M;kWh;BN01;2026-07-08T21:15:00Z;0,030000;OK\n';
  const r = parseConsumptionCsv(csv);
  assert.equal(r.format, 'datahub');
  assert.equal(r.points.length, 3); // vartit korvaavat saman tunnin tuntiarvon
  assert.equal(r.estimated, 0);
  assert.equal(r.resolutionMin, 15);
});

test('virheellinen tiedosto', () => {
  assert.throws(() => parseConsumptionCsv('foo;bar\n1;2\n'), /aika- ja kulutussarakkeita/);
});

test('analyysi: kustannukset, kiinteä hinta, siirtosäästö', () => {
  const H = 3600000;
  const t0 = Date.parse('2026-01-14T22:00:00Z'); // 15.1. klo 00 Suomen aikaa
  const points = Array.from({ length: 24 }, (_, i) => ({ t: t0 + i * H, kwh: i === 18 ? 3 : 0.1, min: 60 }));
  const spotAt = (t) => (Math.floor((t - t0) / H) === 18 ? 40 : 4); // klo 18 kallis
  const s = { ...DEFAULT_SETTINGS, vat: 0, margin: 0 };
  const { rows, missing } = joinPrices(points, spotAt, s);
  assert.equal(missing, 0);
  const a = analyze(rows, t0, t0 + 24 * H, { fixedPrice: 10, shiftShare: 1, baseW: 100 });
  assert.equal(a.nDays, 1);
  assert.ok(Math.abs(a.kwh - (23 * 0.1 + 3)) < 1e-9);
  assert.ok(Math.abs(a.spotCost - (23 * 0.1 * 4 + 3 * 40) / 100) < 1e-9);
  assert.ok(Math.abs(a.fixedCost - a.kwh * 0.1) < 1e-9);
  // joustava osa klo 18: 3 - 0,1 = 2,9 kWh, hintaero 40 - 4 = 36 c -> 1,044 €
  assert.ok(Math.abs(a.saving - 2.9 * 0.36) < 1e-9);
  assert.equal(a.topHours[0].t, t0 + 18 * H);
});

test('peruskulutuksen arvio yöllisistä tunneista', () => {
  const H = 3600000;
  const t0 = Date.parse('2026-01-14T22:00:00Z');
  const pts = Array.from({ length: 24 * 10 }, (_, i) => ({ t: t0 + i * H, kwh: 0.08 }));
  assert.equal(estimateBaseW(pts), 80);
});
