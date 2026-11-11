<script>
  import { onMount } from 'svelte';
  import { api } from './lib/api.js';
  import { net } from './lib/net.svelte.js';
  import { load, loadList, loadOr, save } from './lib/storage.js';
  import { colorScheme, screen } from './lib/chart.svelte.js';
  import { persistOpen } from './lib/persist.js';
  import {
    DEFAULT_SETTINGS, userPrice, bands as makeBands, normalizeSlots, toHours, hhmm, dayLabel,
    localDate, addDays, fmtPrice, CLASS_LABELS, classify, helsinkiToUtc, weekdayShort,
  } from './lib/pricing.js';
  import { startMsFor, schedule, scheduleToHours } from './lib/cost.js';
  import PriceChart from './components/PriceChart.svelte';
  import PriceTable from './components/PriceTable.svelte';
  import Devices from './components/Devices.svelte';
  import CostTable from './components/CostTable.svelte';
  import Heating from './components/Heating.svelte';
  import Settings from './components/Settings.svelte';
  import NowCosts from './components/NowCosts.svelte';
  import ShareChart from './components/ShareChart.svelte';
  import InstallButton from './components/InstallButton.svelte';
  import { VERSION } from './changelog.js';

  const DEFAULT_HEATING = {
    location: 'helsinki', system: 'ilp', mode: 'era', area: 120,
    era: '1986-2002', annual_kwh: 15000, indoor: 21,
    // Lämmin vesi: Motiva, 4 hengen talo 3 670 kWh/v ≈ 2,5 kWh/hlö/vrk
    persons: 3, waterPerPerson: 2.5, waterMode: 'varaaja', waterStart: '02:00', waterPower: 3,
    // Kaukolämmön energiamaksu c/kWh sis. ALV (perusmaksu ei mukana). Tarkista oma hinta lämpöyhtiöltä.
    dhPrice: 10,
    // Asunnon peruskulutus (aina päällä olevat laitteet): kerrostalo | omakotitalo | oma | ei
    baseMode: 'kerrostalo', baseW: 60,
    // Selaimen sijainti pyöristettynä 0,1 asteeseen, esim. "geo:60.2,24.9"; geoAsked: granted|denied
    geo: null, geoAsked: null,
  };

  let settings = $state((() => {
    const raw = loadOr('sporssi.settings', null);
    const s = load('sporssi.settings', DEFAULT_SETTINGS);
    // Aiempi oletusyläraja 40 c/kWh -> 50 c/kWh (käyttäjän itse asettama muu arvo säilyy).
    if (raw && (raw.scaleVersion ?? 1) < 2 && Number(raw.yMax) === 40) s.yMax = 50;
    s.scaleVersion = 2;
    return s;
  })());
  // Ensikäynnillä valittuna tyypillisimmät kodinkoneet.
  const DEFAULT_SELECTION = Object.fromEntries([
    ['pyykinpesukone-60', '18:00'], ['astianpesukone', '19:00'], ['vedenkeitin', '07:00'],
    ['sahkouuni', '17:00'], ['liesi', '17:00'], ['mikroaaltouuni', '12:00'],
    ['kuivausrumpu-lp', '20:00'], ['kiuas', '18:00'],
  ].map(([id, start]) => [id, { start }]));
  const oldSelection = loadOr('sporssi.selection', {});
  let selection = $state(loadOr('sporssi.selection.v2',
    Object.keys(oldSelection).length ? oldSelection : DEFAULT_SELECTION));
  let custom = $state(loadList('sporssi.custom'));
  let heatCfg = $state(load('sporssi.heating', DEFAULT_HEATING));
  $effect(() => save('sporssi.settings', $state.snapshot(settings)));
  $effect(() => save('sporssi.selection.v2', $state.snapshot(selection)));
  $effect(() => save('sporssi.custom', $state.snapshot(custom)));
  $effect(() => save('sporssi.heating', $state.snapshot(heatCfg)));

  let nowMs = $state(Date.now());
  const today = $derived(localDate(nowMs));
  let date = $state(localDate(Date.now()));
  let showSettings = $state(false);

  let stats = $state(null);
  let available = $state(null);
  let catalog = $state([]);
  let heatOptions = $state(null);
  let loadError = $state('');
  let days = $state({}); // VVVV-KK-PP -> { slots, complete, at }
  let heatData = $state(null);
  let heatError = $state('');
  let heatLoading = $state(false);

  const inflight = new Set();
  async function fetchDay(d, force = false) {
    const have = days[d];
    if (have && have.complete && !force) return;
    // Keskeneräisen päivän hinnat julkaistaan edellisenä päivänä n. klo 14: ennen sitä ei kysytä
    // uudelleen, ja sen jälkeen (myöhästynyt julkaisu) enintään 5 min välein.
    if (have && !force) {
      const publish = helsinkiToUtc(addDays(d, -1), 14, 0);
      if (Date.now() < publish || Date.now() - have.at < 5 * 60000) return;
    }
    if (inflight.has(d)) return;
    inflight.add(d);
    try {
      const res = await api.prices(d);
      days[d] = { slots: normalizeSlots(res.slots), complete: res.complete, at: Date.now() };
      loadError = '';
    } catch (e) {
      loadError = `Hintojen haku epäonnistui: ${e.message}`;
    } finally {
      inflight.delete(d);
    }
  }

  // Sijainti: kysytään ensikäynnillä. Jos lupa on jo annettu, sijainti päivitetään hiljaa.
  let geoStatus = $state('');
  function locate(manual = false) {
    if (!('geolocation' in navigator)) {
      if (manual) geoStatus = 'Selain ei tue sijaintia.';
      return;
    }
    geoStatus = manual ? 'Haetaan sijaintia…' : '';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 10) / 10;
        const lon = Math.round(pos.coords.longitude * 10) / 10;
        const id = `geo:${lat.toFixed(1)},${lon.toFixed(1)}`;
        const wasGeo = !heatCfg.location || heatCfg.location.startsWith('geo:');
        heatCfg.geo = id;
        if (manual || heatCfg.geoAsked !== 'granted' || wasGeo) heatCfg.location = id;
        heatCfg.geoAsked = 'granted';
        geoStatus = '';
      },
      (err) => {
        heatCfg.geoAsked = 'denied';
        if (heatCfg.location?.startsWith('geo:')) heatCfg.location = 'helsinki';
        geoStatus = manual
          ? (err.code === err.PERMISSION_DENIED
            ? 'Sijainnin käyttö on estetty. Salli se selaimen osoiterivin asetuksista ja yritä uudelleen.'
            : 'Sijaintia ei saatu.')
          : '';
      },
      { enableHighAccuracy: false, maximumAge: 3600000, timeout: 20000 },
    );
  }

  function loadMeta() {
    api.stats().then((r) => { stats = r.stats; available = r.available; }).catch(() => {});
    api.devices().then((r) => { catalog = r; loadError = ''; }).catch((e) => { if (!catalog.length) loadError = `Laitteiden haku epäonnistui: ${e.message}`; });
    api.heatingOptions().then((r) => { heatOptions = r; }).catch(() => {});
  }

  // Kun yhteys palaa, haetaan näkyvät tiedot uudelleen (välimuistista näytetyt korvautuvat).
  function onOnline() {
    loadMeta();
    for (const d of new Set([addDays(date, -1), date, addDays(date, 1), today, addDays(today, 1)])) fetchDay(d, true);
    heatMemo.clear();
    heatReload += 1;
  }

  onMount(() => {
    if (heatCfg.geoAsked !== 'denied') locate(false);
    loadMeta();
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => {
      nowMs = Date.now();
      for (const d of new Set([addDays(date, -1), date, addDays(date, 1), today, addDays(today, 1)])) {
        if (days[d] && !days[d].complete && d <= addDays(today, 1)) fetchDay(d);
      }
    }, 60000);
    return () => { clearInterval(timer); window.removeEventListener('online', onOnline); };
  });

  // Käyttö nyt -kaaviot tarvitsevat aina tämän päivän ja huomisen hinnat.
  $effect(() => {
    fetchDay(today);
    fetchDay(addDays(today, 1));
  });

  $effect(() => {
    const d = date;
    fetchDay(d);
    fetchDay(addDays(d, -1));
    if (d < addDays(today, 1)) fetchDay(addDays(d, 1));
  });

  const bands = $derived(makeBands(stats, settings));
  const unit = $derived(settings.priceMode === 'spot' ? 'c/kWh (ALV 0)' : 'c/kWh');
  const cur = $derived(days[date]);
  const daySlots = $derived(cur?.slots ?? []);
  const hours = $derived(toHours(daySlots));

  // Hintakaavio tänään: edellisestä tunnista eteenpäin niin pitkälle kuin hintoja on (myös huominen),
  // kuluneet tunnit vain pyydettäessä. Muina päivinä koko vuorokausi.
  const rolling = $derived(date === today);
  const hourStartNow = $derived(nowMs - (nowMs % 3600000));
  const chartSlots = $derived.by(() => {
    if (!rolling) return daySlots;
    const all = [...(days[today]?.slots ?? []), ...(days[addDays(today, 1)]?.slots ?? [])];
    const from = settings.showPast ? (all[0]?.t ?? 0) : hourStartNow - 3600000;
    const out = [];
    for (const s of all) {
      if (s.t < from) continue;
      if (s.spot === null && s.t > nowMs) break; // tuntemattomat (huominen ennen julkaisua)
      out.push(s);
    }
    // vain kokonaiset tunnit, jotta tuntinäkymä pysyy tasassa
    return out.slice(0, out.length - (out.length % 4));
  });
  const chartHours = $derived(toHours(chartSlots));
  const includesTomorrow = $derived(rolling && chartSlots.some((s) => localDate(s.t) !== today));
  const whenLabel = (t) => (localDate(t) === today ? `klo ${hhmm(t)}` : `${weekdayShort(t)} klo ${hhmm(t)}`);
  const priceMap = $derived.by(() => {
    const m = new Map();
    for (const d of [addDays(date, -1), date, addDays(date, 1)]) {
      for (const s of days[d]?.slots ?? []) m.set(s.t, userPrice(s.spot, settings));
    }
    return m;
  });
  const priceAt = $derived((t) => priceMap.get(t) ?? null);

  const scheme = colorScheme();
  const nowPrices = $derived.by(() => {
    const m = new Map();
    let last = 0;
    for (const d of [today, addDays(today, 1)]) {
      for (const s of days[d]?.slots ?? []) {
        if (s.spot === null) continue;
        m.set(s.t, userPrice(s.spot, settings));
        last = Math.max(last, s.t);
      }
    }
    return { map: m, last };
  });
  const nowPriceAt = $derived((t) => nowPrices.map.get(t) ?? null);
  // Hintakäyrä Laitteiden käyttö nyt -kaavion taustalle: tänään klo 00:sta niin pitkälle kuin hintoja on.
  const todayLine = $derived.by(() => {
    const out = [];
    for (const s of [...(days[today]?.slots ?? []), ...(days[addDays(today, 1)]?.slots ?? [])]) {
      if (s.spot === null) { if (s.t > nowMs) break; continue; }
      out.push({ t: s.t, v: userPrice(s.spot, settings), cls: classify(s.spot, bands) });
    }
    return out;
  });

  const summary = $derived.by(() => {
    const vals = chartSlots.filter((s) => s.spot !== null).map((s) => ({ t: s.t, v: userPrice(s.spot, settings), spot: s.spot }));
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b.v, 0) / vals.length;
    const min = vals.reduce((a, b) => (b.v < a.v ? b : a));
    const max = vals.reduce((a, b) => (b.v > a.v ? b : a));
    const now = vals.find((s) => nowMs >= s.t && nowMs < s.t + 15 * 60000);
    return { avg, min, max, now, n: vals.length };
  });

  // Valitut laitteet aikataulua varten
  // Lämmin vesi lasketaan lämmitysosion asetuksista, ei laitelistasta.
  const WATER_IDS = new Set(['lamminvesivaraaja']);
  const appliances = $derived(catalog.filter((d) => !WATER_IDS.has(d.id)));
  const allDevices = $derived([...appliances, ...custom]);
  const scheduled = $derived(
    allDevices.filter((d) => selection[d.id]).map((d) => {
      const dev = { ...d, ...selection[d.id] };
      return { key: d.id, dev, startMs: startMsFor(daySlots, dev.start, hhmm) };
    }),
  );

  // Hintakaavion laitekerrokset: enintään 3 laitetta, kullakin pysyvä väripaikka (slot).
  const MAX_OVERLAYS = 3;
  let overlaySlots = $state((() => {
    const v = loadOr('sporssi.overlays', []);
    return Array.from({ length: MAX_OVERLAYS }, (_, i) => (Array.isArray(v) && typeof v[i] === 'string' ? v[i] : null));
  })());
  $effect(() => save('sporssi.overlays', $state.snapshot(overlaySlots)));
  const overlayCandidates = $derived(scheduled.filter((s) => s.dev.kind !== 'continuous'));
  const overlays = $derived(overlaySlots
    .map((id, slot) => {
      const s = id && overlayCandidates.find((c) => c.key === id);
      if (!s) return null;
      let startMs = s.startMs;
      if (rolling) {
        // valittu aloitus tänään; jos se on jo mennyt, seuraava esiintymä huomenna
        const tomorrowSlots = days[addDays(today, 1)]?.slots ?? [];
        if (startMs < nowMs - (nowMs % 900000) && tomorrowSlots.length) startMs = startMsFor(tomorrowSlots, s.dev.start, hhmm);
      }
      return { ...s, startMs, slot };
    })
    .filter(Boolean));
  function toggleOverlay(id) {
    const i = overlaySlots.indexOf(id);
    if (i >= 0) { overlaySlots[i] = null; return; }
    const free = overlaySlots.findIndex((x, k) => x === null || !overlayCandidates.some((c) => c.key === overlaySlots[k]));
    if (free >= 0) overlaySlots[free] = id;
  }

  // Lämmin vesi: varaaja lämmittää vuorokauden tarpeen ajastettuna tai kulutus jaetaan tasaisesti.
  const DISTRICT = 'kaukolampo';
  const district = $derived(heatCfg.system === DISTRICT);
  const waterDistrict = $derived(heatCfg.waterMode === DISTRICT);
  const dhPriceAt = $derived(() => Number(heatCfg.dhPrice) || 0);
  const waterDev = $derived.by(() => {
    const kwh = Math.max(0, Number(heatCfg.persons) || 0) * Math.max(0, Number(heatCfg.waterPerPerson) || 0);
    if (heatCfg.waterMode === 'tasainen' || heatCfg.waterMode === DISTRICT) {
      return { id: 'lammin-vesi', name: 'Lämmin vesi', kind: 'continuous', annual_kwh: kwh * 365, duration_min: 1440 };
    }
    const power = Math.max(0.5, Number(heatCfg.waterPower) || 3);
    return {
      id: 'lammin-vesi', name: 'Lämmin vesi', kind: 'power', power_kw: power,
      duration_min: Math.max(1, Math.round((kwh / power) * 60)), start: heatCfg.waterStart,
    };
  });

  // Peruskulutus: tasainen teho koko vuorokauden (kylmälaitteet, ilmanvaihto, valmiustilat).
  const BASE_PRESETS = { kerrostalo: 60, omakotitalo: 170 };
  const baseW = $derived(heatCfg.baseMode === 'ei' ? 0
    : heatCfg.baseMode === 'oma' ? Math.max(0, Number(heatCfg.baseW) || 0)
      : BASE_PRESETS[heatCfg.baseMode] ?? 60);
  const baseDev = $derived({ id: 'peruskulutus', name: 'Peruskulutus', kind: 'continuous',
    annual_kwh: (baseW * 24 * 365) / 1000, duration_min: 1440 });
  // Peruskulutukseen jo sisältyvät laitteet, jos ne on valittu myös laitteista (kaksinkertainen laskenta).
  const BASE_OVERLAP = ['jaakaappi', 'pakastin', 'jaakaappipakastin', 'ilmanvaihto'];
  const baseOverlap = $derived(baseW > 0 ? scheduled.filter((s) => BASE_OVERLAP.includes(s.key)).map((s) => s.dev.name) : []);

  // Loppusummataulukko: kodinkoneet yhtenä sarakkeena + peruskulutus + lämmin vesi + rakennuksen lämmitys.
  const tableColumns = $derived([
    { key: 'appliances', name: 'Kodinkoneet', short: 'Koneet', title: 'Valittujen kodinkoneiden yhteenlaskettu kulutus' },
    ...(baseW > 0 ? [{ key: 'base', name: 'Peruskulutus', short: 'Perus', title: 'Aina päällä olevat laitteet' }] : []),
    { key: 'water', name: 'Lämmin vesi', short: waterDistrict ? 'Vesi (KL)' : 'Vesi', tiny: waterDistrict ? 'Vesi KL' : 'Vesi',
      title: waterDistrict ? 'Lämmin vesi (kaukolämpö)' : 'Lämmin vesi' },
    { key: 'heating', name: 'Rakennuksen lämmitys', short: district ? 'Lämmitys (KL)' : 'Lämmitys', tiny: district ? 'Lämm. KL' : 'Lämm.',
      title: district ? 'Rakennuksen lämmitys (kaukolämpö)' : 'Rakennuksen lämmitys' },
  ]);
  const tableDevices = $derived([
    ...scheduled.map((s) => ({ ...s, key: 'appliances' })),
    ...(baseW > 0 ? [{ key: 'base', dev: baseDev, startMs: daySlots[0]?.t ?? 0 }] : []),
    {
      key: 'water', dev: waterDev, startMs: startMsFor(daySlots, waterDev.start ?? '00:00', hhmm),
      ...(waterDistrict ? { priceAt: dhPriceAt } : {}),
    },
  ]);

  // Lämmitys
  const heatMemo = new Map();
  let heatReload = $state(0);
  $effect(() => {
    const c = $state.snapshot(heatCfg);
    const d = date;
    // Kaukolämmössä tarvitaan lämpöenergia: hyötysuhde 1 kuten suoralla sähköllä.
    const params = {
      date: d, location: c.location, system: c.system === DISTRICT ? 'suora' : c.system, indoor: c.indoor,
      ...(c.mode === 'era' ? { area: c.area, era: c.era } : { annual_kwh: c.annual_kwh }),
    };
    heatReload;
    // Saman käyttökerran aikana jo haettu arvio käytetään uudelleen (10 min), esim. päivää vaihdettaessa.
    const key = JSON.stringify(params);
    const hit = heatMemo.get(key);
    if (hit && Date.now() - hit.at < 10 * 60000) { heatData = hit.data; heatError = ''; return; }
    heatLoading = true;
    const timer = setTimeout(() => {
      api.heating(params)
        .then((r) => { heatData = r; heatError = ''; if (!net.offline) heatMemo.set(key, { at: Date.now(), data: r }); })
        .catch((e) => { heatError = `Lämmitysarvio epäonnistui: ${e.message}`; heatData = null; })
        .finally(() => { heatLoading = false; });
    }, 300);
    return () => clearTimeout(timer);
  });
  const heatExtra = $derived.by(() => {
    const ok = heatData && heatData.date === date;
    const byHour = new Map(ok ? heatData.hours.map((h) => [Date.parse(h.start), h.elec_kwh]) : []);
    return [{
      key: 'heating',
      ...(district ? { priceAt: dhPriceAt } : {}),
      kwhAt: (t) => {
        const v = byHour.get(t - (t % 3600000));
        return v === null || v === undefined ? null : v / 4;
      },
    }];
  });

  // Lämmityksen ja lämpimän veden tuntikustannukset lämmitysosion kaaviota varten.
  // Kulutusjakauma: sama data kuin kustannustaulukossa, mutta kodinkoneet laitteittain.
  // Vain valitun vuorokauden sisällä oleva kulutus (yli puolenyön jatkuva käyttö ei mukana).
  const shareParts = $derived.by(() => {
    const waterEntry = tableDevices.find((d) => d.key === 'water');
    const baseEntry = tableDevices.find((d) => d.key === 'base');
    const res = schedule(daySlots, [...scheduled, ...(baseEntry ? [baseEntry] : []), ...(waterEntry ? [waterEntry] : [])], priceAt, heatExtra);
    const sums = {};
    let heatingUnknown = false;
    for (const r of res.rows) {
      for (const [k, c] of Object.entries(r.cells)) {
        if (c.kwh === null) { if (k === 'heating') heatingUnknown = true; continue; }
        const acc = (sums[k] ??= { kwh: 0, eur: 0 });
        acc.kwh += c.kwh;
        acc.eur += c.eur ?? 0;
      }
    }
    const parts = scheduled.map((s) => ({ key: s.key, name: s.dev.name, group: 'appliance', ...(sums[s.key] ?? { kwh: 0, eur: 0 }) }));
    if (sums.base) parts.push({ key: 'base', name: 'Peruskulutus', group: 'base', ...sums.base });
    parts.push({ key: 'water', name: waterDistrict ? 'Lämmin vesi (kaukolämpö)' : 'Lämmin vesi', group: 'water', ...(sums.water ?? { kwh: 0, eur: 0 }) });
    parts.push({ key: 'heating', name: district ? 'Rakennuksen lämmitys (kaukolämpö)' : 'Rakennuksen lämmitys', group: 'heating', ...(sums.heating ?? { kwh: 0, eur: 0 }) });
    return { parts, heatingUnknown };
  });

  const heatCostHours = $derived.by(() => {
    const waterEntry = tableDevices.find((d) => d.key === 'water');
    const res = schedule(daySlots, waterEntry ? [waterEntry] : [], priceAt, heatExtra);
    return scheduleToHours(res.rows).map((r) => ({
      t: r.t,
      heating: r.cells.heating?.eur ?? null,
      heatingKwh: r.cells.heating?.kwh ?? null,
      water: r.cells.water?.eur ?? 0,
      waterKwh: r.cells.water?.kwh ?? 0,
    }));
  });

  // Kaavion tekstivastine ruudunlukijalle.
  const priceChartLabel = $derived(summary
    ? `Pörssisähkön hinta, ${rolling ? `tänään ${includesTomorrow ? 'ja huomenna ' : ''}${settings.showPast ? '' : 'edellisestä tunnista alkaen'}` : dayLabel(date).toLowerCase()}, ${settings.resolution === 'quarter' ? 'varteittain' : 'tunneittain'}: `
      + `keskihinta ${fmtPrice(summary.avg)} ${unit}, halvin ${fmtPrice(summary.min.v)} ${whenLabel(summary.min.t)}, `
      + `kallein ${fmtPrice(summary.max.v)} ${whenLabel(summary.max.t)}. Tarkat hinnat ovat hintataulukossa.`
    : 'Pörssisähkön hintakaavio');

  const canNext = $derived(date < addDays(today, 1));
  const canPrev = $derived(!available || date > available.first);
  const tomorrowPending = $derived(date === addDays(today, 1) && cur && !cur.complete);
</script>

<a class="skip" href="#sisalto">Siirry sisältöön</a>
<div class="wrap">
  <header class="row head">
    <div>
      <h1>Spörssi</h1>
      <p class="muted small">Pörssisähkön hinta ja kodin laitteiden käyttökustannukset</p>
    </div>
    <span class="spacer"></span>
    <InstallButton />
    <button type="button" aria-expanded={showSettings} aria-controls="asetukset"
      onclick={() => (showSettings = !showSettings)}><span aria-hidden="true">⚙</span> Asetukset</button>
  </header>

  <main id="sisalto" tabindex="-1">
  {#if showSettings}
    <section class="card" id="asetukset" aria-labelledby="asetukset-otsikko">
      <h2 id="asetukset-otsikko">Asetukset</h2>
      <Settings bind:settings {bands} />
    </section>
  {/if}

  {#if net.offline}
    <p class="offline" role="status">Ei verkkoyhteyttä – näytetään {net.storedAt
      ? `${localDate(net.storedAt) === today ? 'tänään' : localDate(net.storedAt)} klo ${hhmm(net.storedAt)}`
      : 'aiemmin'} tallennetut tiedot.</p>
  {:else if loadError}<p class="error">{loadError}</p>{/if}

  <section class="card">
    <div class="row">
      <h2>Laitteiden käyttö nyt (klo {hhmm(Math.floor(nowMs / 900000) * 900000)})</h2>
      <span class="spacer"></span>
      <a href="#laitteet">Valitse laitteet ({scheduled.length}) ↓</a>
    </div>
    <NowCosts devices={scheduled} priceAt={nowPriceAt} {nowMs} lastKnownMs={nowPrices.last} {scheme} {unit} priceLine={todayLine} />
  </section>

  <section class="card">
    <div class="row nav">
      <button type="button" disabled={!canPrev} onclick={() => (date = addDays(date, -1))}>◀ Edellinen</button>
      <button type="button" disabled={date === today} onclick={() => (date = today)}>Tänään</button>
      <button type="button" disabled={!canNext} onclick={() => (date = addDays(date, 1))}>Seuraava ▶</button>
      <input type="date" aria-label="Valitse päivä" value={date} min={available?.first} max={addDays(today, 1)}
        onchange={(e) => e.currentTarget.value && (date = e.currentTarget.value)} />
      <span class="spacer"></span>
      {#if !settings.autoScale}
        <label class="ymax">Asteikko enintään
          <input type="number" min="5" max="500" step="5" bind:value={settings.yMax} /> c/kWh</label>
      {/if}
      <div class="seg" role="group" aria-label="Tarkkuus">
        <button type="button" aria-pressed={settings.resolution === 'hour'} class:on={settings.resolution === 'hour'} onclick={() => (settings.resolution = 'hour')}>Tunti</button>
        <button type="button" aria-pressed={settings.resolution === 'quarter'} class:on={settings.resolution === 'quarter'} onclick={() => (settings.resolution = 'quarter')}>15 min</button>
      </div>
    </div>
    <h2 class="day">{dayLabel(date)}{date === today ? (includesTomorrow ? ' (tänään) ja huomenna' : ' (tänään)') : date === addDays(today, 1) ? ' (huomenna)' : ''}</h2>
    {#if rolling}
      <label class="past"><input type="checkbox" bind:checked={settings.showPast} /> Näytä myös tämän päivän kuluneet tunnit</label>
    {/if}

    {#if summary}
      <div class="row stats">
        {#if summary.now && date === today}
          <div class="stat"><span class="muted small">Nyt</span>
            <b class="big"><span class="swatch c-{classify(summary.now.spot, bands)}" aria-hidden="true"></span> {fmtPrice(summary.now.v)}<span class="sr-only"> ({CLASS_LABELS[classify(summary.now.spot, bands)]})</span></b>
            <span class="small muted">{unit}</span></div>
        {/if}
        <div class="stat"><span class="muted small">{rolling ? 'Keskihinta' : 'Päivän keskihinta'}</span><b class="big">{fmtPrice(summary.avg)}</b><span class="small muted">{unit}</span></div>
        <div class="stat"><span class="muted small">Halvin</span><b class="big">{fmtPrice(summary.min.v)}</b><span class="small muted">{whenLabel(summary.min.t)}</span></div>
        <div class="stat"><span class="muted small">Kallein</span><b class="big">{fmtPrice(summary.max.v)}</b><span class="small muted">{whenLabel(summary.max.t)}</span></div>
        {#if stats}
          <div class="stat"><span class="muted small">{stats.coverage < 0.9 ? `Keskihinta (${Math.round(stats.slots / 96)} vrk)` : '12 kk keskihinta'}</span><b class="big">{fmtPrice(userPrice(stats.mean, settings))}</b><span class="small muted">hajonta ± {fmtPrice(stats.std)} (ALV 0)</span></div>
        {/if}
      </div>
    {:else if tomorrowPending}
      <p class="muted">Huomisen hinnat julkaistaan noin klo 14 Suomen aikaa.</p>
    {:else if cur}
      <p class="muted">Tälle päivälle ei ole hintatietoja.</p>
    {:else}
      <p class="muted">Ladataan…</p>
    {/if}

    {#if summary && stats && stats.coverage < 0.9}
      <p class="small warn">Tietokannassa on hintahistoriaa vain {Math.round(stats.slots / 96)} vuorokaudelta, joten
        värialueet eivät vielä kuvaa vuoden tasoa. Ylläpitäjä: aja <code>python -m sporssi.cli backfill --days 400</code>.</p>
    {/if}
    {#if summary}
      {#if overlayCandidates.length}
        <div class="overlay-pick" role="group" aria-label="Näytä laitteiden käyttöjaksot hintakaaviossa">
          <span class="muted">Näytä kaaviossa:</span>
          {#each overlayCandidates as c (c.key)}
            {@const slot = overlaySlots.indexOf(c.key)}
            {@const full = slot < 0 && overlays.length >= MAX_OVERLAYS}
            <button type="button" class="ov" class:on={slot >= 0} aria-pressed={slot >= 0} disabled={full}
              title={full ? 'Enintään 3 laitetta kerrallaan' : ''} style={slot >= 0 ? `--c: var(--ov${slot + 1})` : ''}
              onclick={() => toggleOverlay(c.key)}>{c.dev.name}</button>
          {/each}
        </div>
      {/if}
      <PriceChart {scheme} label={priceChartLabel} rows={settings.resolution === 'quarter' ? chartSlots : chartHours} {settings} {bands} {nowMs} {unit}
        {overlays} costAt={priceAt} />
      {#if overlays.length}
        <p class="small muted">Laitteen kaistassa täytetty palkki on halvin käyttöjakso ja katkoviivakehys valittu
          aloitusaika. Viiva näyttää käyttökerran hinnan (€, oikea asteikko), jos laite käynnistetään kyseisellä
          {settings.resolution === 'quarter' ? 'vartilla' : 'tunnilla'}.</p>
      {/if}
      <div class="row small legend">
        {#each ['cheap', 'green', 'yellow', 'red'] as c}
          <span><span class="swatch c-{c}"></span> {CLASS_LABELS[c]}</span>
        {/each}
        <span class="muted">Vihreä alue = 12 kk keskihinta ± keskihajonta{settings.autoScale ? '' : ' · kiinteä asteikko'}</span>
      </div>
      <details class="table-toggle" use:persistOpen={'hintataulukko'}>
        <summary>Hintataulukko</summary>
        <PriceTable hours={chartHours} {settings} {bands} {nowMs} {unit} />
      </details>
    {/if}
  </section>

  <section class="card">
    <h2>Lämmitys, lämmin vesi ja peruskulutus</h2>
    <Heating {baseW} {baseOverlap} options={heatOptions} bind:cfg={heatCfg} data={heatData} error={heatError} loading={heatLoading} water={waterDev} costHours={heatCostHours} {geoStatus} onlocate={() => locate(true)} />
  </section>

  <section class="card" id="laitteet">
    <h2>Laitteet</h2>
    <Devices catalog={appliances} bind:custom bind:selection {daySlots} {priceAt} {nowMs} isToday={date === today} />
  </section>

  <section class="card" aria-labelledby="jakauma-otsikko">
    <h2 id="jakauma-otsikko">Vuorokauden kulutusjakauma</h2>
    <ShareChart parts={shareParts.parts} {scheme}
      note={(shareParts.heatingUnknown ? 'Osalta tunneista puuttuu säätieto, joten lämmityksen osuus voi olla todellista pienempi. ' : '')
        + (district || waterDistrict ? 'Kaukolämmön osuus on lämpöenergiaa, ei sähköä.' : '')} />
  </section>

  <section class="card">
    <NowCosts part="future" devices={scheduled} priceAt={nowPriceAt} {nowMs} lastKnownMs={nowPrices.last} {scheme} {unit} />
  </section>

  <section class="card">
    <details class="cost-toggle" use:persistOpen={'kustannustaulukko'}>
      <summary><h2>Kulutus ja kustannukset {settings.resolution === 'quarter' ? 'varteittain' : 'tunneittain'}</h2></summary>
    <p class="small muted">Kulutus kWh ja kustannus €; sähkön hinta {unit}{#if screen.narrow} (sarake c){/if}.</p>
    {#if district || waterDistrict}
      <p class="small muted">KL = kaukolämpö. Kaukolämmön sarakkeissa kWh on lämpöenergiaa ja hinta lasketaan kaukolämmön
        energiamaksulla {fmtPrice(Number(heatCfg.dhPrice))} c/kWh (perusmaksu ei sisälly). Ne eivät kuluta sähköä.</p>
    {/if}
    <CostTable {daySlots} columns={tableColumns} devices={tableDevices} extra={heatExtra} {priceAt} resolution={settings.resolution} {nowMs} {unit} />
    </details>
  </section>

  </main>

  <footer class="small muted">
    Hinnat: Nord Poolin day-ahead-hinnat alueelle FI (ENTSO-E Transparency Platform / sahkotin.fi).
    Säätiedot: Ilmatieteen laitoksen avoin data. Laitteiden kulutustiedot: Motiva, EU:n energiamerkintä (EPREL),
    Helen; lähteet näkyvät kunkin laitteen kohdalla. Kustannukset ovat arvioita.
    <p class="version"><a href="./muutokset.html" title="Muutoshistoria">Spörssi versio {VERSION}</a>
      · © 2026 hazorus · Lisenssi <a href="./LICENSE.txt">EUPL-1.2</a>
      · <a href="https://github.com/hazorus/sporssi">Lähdekoodi</a>
      · <a href="./third-party-licenses.txt">Kolmansien osapuolten lisenssit</a></p>
  </footer>
</div>

<style>
  .head { margin-bottom: .5rem; position: relative; }
  .offline { border-left: 4px solid var(--yellow); background: var(--card); padding: .5rem .8rem; border-radius: 6px; margin: 0 0 1rem; }
  .head h1 { font-size: 1.6rem; margin: 0; }
  .head p { margin: .1rem 0 0; }
  .nav { margin-bottom: .6rem; }
  .day { margin: .3rem 0 .6rem; }
  .stats { gap: 1.2rem; margin-bottom: .4rem; }
  .stat { display: flex; flex-direction: column; min-width: 7rem; }
  .big { font-size: 1.35rem; font-variant-numeric: tabular-nums; }
  .legend { gap: 1rem; margin: .2rem 0 .6rem; }
  .table-toggle summary { font-weight: 600; margin: .4rem 0; }
  .past { display: block; margin: -.3rem 0 .6rem; }
  .ymax { display: inline-flex; align-items: center; gap: .4rem; }
  .ymax input { width: 5rem; }
  .overlay-pick { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; margin: .2rem 0 .5rem; }
  /* Valittu: laitteen värinen kehys ja täplä; teksti normaalivärinen (kontrasti) */
  .ov.on { border: 2px solid var(--c); font-weight: 600; }
  .ov.on::before { content: '●'; color: var(--c); margin-right: .3rem; }
  .cost-toggle > summary { cursor: pointer; }
  .cost-toggle > summary h2 { display: inline; margin: 0; }
  .cost-toggle[open] > summary { margin-bottom: .5rem; }
  footer { padding: 0 .2rem 2rem; }
  .version { margin: .6rem 0 0; }
  .warn { border-left: 3px solid var(--yellow); padding: .3rem .6rem; background: var(--row-alt); }
</style>
