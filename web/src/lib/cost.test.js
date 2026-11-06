import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceEnergy, deviceSlotEnergy, runCost, bestStart, schedule, scheduleToHours } from './cost.js';
import { userPrice, classify, toHours, DEFAULT_SETTINGS, addDays } from './pricing.js';

const Q = 15 * 60 * 1000;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('laitteen energia', () => {
  close(deviceEnergy({ kind: 'power', power_kw: 2, duration_min: 30 }), 1);
  close(deviceEnergy({ kind: 'cycle', energy_kwh: 0.8 }), 0.8);
  close(deviceEnergy({ kind: 'continuous', annual_kwh: 365 }), 1);
});

test('energia jaetaan varteille, vajaa viimeinen jakso', () => {
  const parts = deviceSlotEnergy({ kind: 'power', power_kw: 4, duration_min: 20 });
  assert.equal(parts.length, 2);
  close(parts[0], 1);
  close(parts[1], 1 / 3);
  const prof = deviceSlotEnergy({ kind: 'cycle', energy_kwh: 1, duration_min: 30, profile: [3, 1] });
  close(prof[0], 0.75);
});

test('kustannus ja halvin aloitus', () => {
  const prices = [10, 20, 1, 2, 30];
  const priceAt = (t) => prices[t / Q] ?? null;
  const dev = { kind: 'cycle', energy_kwh: 1, duration_min: 30 };
  close(runCost(dev, 0, priceAt), (0.5 * 10 + 0.5 * 20) / 100);
  assert.equal(runCost(dev, 4 * Q, priceAt), null);
  const best = bestStart(dev, [0, Q, 2 * Q, 3 * Q, 4 * Q], priceAt);
  assert.equal(best.t, 2 * Q);
});

test('aikataulu ja tuntikoonti', () => {
  const slots = Array.from({ length: 8 }, (_, i) => ({ t: i * Q }));
  const priceAt = (t) => (t < 8 * Q ? 10 : 20);
  const { rows, totals } = schedule(slots, [
    { key: 'a', dev: { kind: 'power', power_kw: 4, duration_min: 30 }, startMs: 7 * Q },
    { key: 'b', dev: { kind: 'continuous', annual_kwh: 365 }, startMs: 0 },
  ], priceAt);
  close(totals.a.kwh, 2);
  close(totals.a.outside, 1);
  close(totals.a.eur, 0.1 + 0.2);
  close(totals.b.kwh, 1);
  const hours = scheduleToHours(rows);
  assert.equal(hours.length, 2);
  close(hours[1].cells.a.kwh, 1);
});

test('hinnan muunnos ja luokittelu', () => {
  const s = { ...DEFAULT_SETTINGS, vat: 25.5, margin: 0.5, transfer: 0, includeTax: false };
  close(userPrice(10, s), 13.05);
  close(userPrice(-1, s), -0.5);
  assert.equal(userPrice(5, { ...s, priceMode: 'spot' }), 5);
  const b = { mean: 5, low: 0, high: 10, red: 15 };
  assert.equal(classify(-1, b), 'cheap');
  assert.equal(classify(5, b), 'green');
  assert.equal(classify(12, b), 'yellow');
  assert.equal(classify(16, b), 'red');
  const h = toHours([{ t: 0, spot: 1 }, { t: Q, spot: 3 }, { t: 2 * Q, spot: 1 }, { t: 3 * Q, spot: 3 }]);
  close(h[0].spot, 2);
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
});

test('saman avaimen laitteet summataan', () => {
  const slots = Array.from({ length: 4 }, (_, i) => ({ t: i * Q }));
  const { rows, totals } = schedule(slots, [
    { key: 'k', dev: { kind: 'power', power_kw: 4, duration_min: 15 }, startMs: 0 },
    { key: 'k', dev: { kind: 'power', power_kw: 8, duration_min: 15 }, startMs: 0 },
  ], () => 10);
  close(rows[0].cells.k.kwh, 3);
  close(totals.k.kwh, 3);
  close(totals.k.eur, 0.3);
});

test('Suomen aika -> UTC (talvi- ja kesäaika)', async () => {
  const { helsinkiToUtc } = await import('./pricing.js');
  assert.equal(new Date(helsinkiToUtc('2026-11-06', 14, 0)).toISOString(), '2026-11-06T12:00:00.000Z');
  assert.equal(new Date(helsinkiToUtc('2026-07-01', 14, 0)).toISOString(), '2026-07-01T11:00:00.000Z');
});
