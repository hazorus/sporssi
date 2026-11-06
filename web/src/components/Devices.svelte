<script>
  import { deviceEnergy, runCost, bestStart, startMsFor } from '../lib/cost.js';
  import { hhmm, fmtEur, fmtKwh, SLOT_MS } from '../lib/pricing.js';
  import { screen } from '../lib/chart.svelte.js';

  // Luettelon arvot ilman turhia desimaaleja: 0,5 kWh/kerta, 150 kWh/v.
  const short = (v) => (v === null || v === undefined ? '–'
    : Number(v).toLocaleString('fi-FI', { maximumFractionDigits: 2 }));
  function spec(dev) {
    if (dev.kind === 'continuous') return `${short(dev.annual_kwh)} kWh/v`;
    if (dev.kind === 'cycle') return `${short(dev.energy_kwh)} kWh/kerta`;
    return `${short(dev.power_kw)} kW`;
  }
  const countIn = (cat) => all.filter((d) => d.category === cat && selection[d.id]).length;

  let { catalog, custom = $bindable(), selection = $bindable(), daySlots, priceAt, nowMs, isToday } = $props();

  const all = $derived([...catalog, ...custom]);
  const categories = $derived([...new Set(all.map((d) => d.category))]);

  function effective(dev) {
    return { ...dev, ...(selection[dev.id] ?? {}) };
  }

  function toggle(dev, on) {
    if (on) selection[dev.id] = { start: dev.default_start ?? '18:00' };
    else delete selection[dev.id];
  }

  const selected = $derived(all.filter((d) => selection[d.id]).map((d) => effective(d)));

  function info(dev) {
    const kwh = deviceEnergy(dev);
    if (dev.kind === 'continuous') {
      const eur = daySlots.reduce((acc, s) => {
        const p = priceAt(s.t);
        return acc === null || p === null ? null : acc + ((kwh / daySlots.length) * p) / 100;
      }, 0);
      return { kwh, eur, continuous: true };
    }
    const startMs = startMsFor(daySlots, dev.start, hhmm);
    const eur = runCost(dev, startMs, priceAt);
    const from = isToday ? Math.floor(nowMs / SLOT_MS) * SLOT_MS : -Infinity;
    const best = dev.shiftable === false ? null
      : bestStart(dev, daySlots.map((s) => s.t).filter((t) => t >= from), priceAt);
    return { kwh, eur, best, startMs };
  }

  // Oma laite
  let form = $state({ name: '', kind: 'power', power_kw: 1, energy_kwh: 1, duration_min: 60, default_start: '18:00' });
  let formError = $state('');
  function addCustom(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { formError = 'Anna laitteelle nimi.'; return; }
    const dur = Number(form.duration_min);
    if (!(dur > 0)) { formError = 'Käyttöajan pitää olla yli 0 min.'; return; }
    const val = form.kind === 'power' ? Number(form.power_kw) : Number(form.energy_kwh);
    if (!(val > 0)) { formError = 'Anna teho tai energia (> 0).'; return; }
    const id = 'oma-' + Date.now().toString(36);
    const dev = {
      id, name, category: 'Omat laitteet', kind: form.kind, duration_min: dur,
      default_start: form.default_start, shiftable: true, custom: true,
      ...(form.kind === 'power' ? { power_kw: val } : { energy_kwh: val }),
      notes: 'Itse lisätty laite', sources: [],
    };
    custom.push(dev);
    selection[id] = { start: dev.default_start };
    form.name = '';
    formError = '';
  }
  function removeCustom(dev) {
    const i = custom.findIndex((d) => d.id === dev.id);
    if (i >= 0) custom.splice(i, 1);
    delete selection[dev.id];
  }
  function set(dev, key, value) {
    selection[dev.id] = { ...selection[dev.id], [key]: value };
  }
</script>

<div class="devices">
  <div class="selected-col">
    <h3>Valitut laitteet ({selected.length})</h3>
    {#if selected.length === 0}
      <p class="muted">Valitse laitteet luettelosta, niin näet niiden käyttökustannukset.</p>
    {/if}
    {#each selected as dev (dev.id)}
      {@const r = info(dev)}
      <div class="dev">
        <div class="dev-head">
          <b class="name">{dev.name}</b>
          <span class="num cost">{fmtKwh(r.kwh)} kWh{r.continuous ? '/vrk' : ''} · <b>{fmtEur(r.eur)}</b></span>
          <button type="button" class="x" title="Poista valinta" aria-label="Poista {dev.name}" onclick={() => toggle(dev, false)}>✕</button>
        </div>
        {#if r.continuous}
          <div class="row small fields">
            <label class="field">Vuosikulutus, kWh <input type="number" min="0" step="10" value={dev.annual_kwh}
              onchange={(e) => set(dev, 'annual_kwh', Number(e.currentTarget.value))} /></label>
            <span class="muted">jaettu tasaisesti vuorokaudelle</span>
          </div>
        {:else}
          <div class="row small fields">
            <label class="field">Aloitus <input type="time" step="900" value={dev.start}
              onchange={(e) => set(dev, 'start', e.currentTarget.value)} /></label>
            <label class="field">Kesto, min <input type="number" min="1" step="1" value={dev.duration_min}
              onchange={(e) => set(dev, 'duration_min', Number(e.currentTarget.value))} /></label>
            {#if dev.kind === 'power'}
              <label class="field">Teho, kW <input type="number" min="0" step="0.01" value={dev.power_kw}
                onchange={(e) => set(dev, 'power_kw', Number(e.currentTarget.value))} /></label>
            {:else}
              <label class="field">kWh/kerta <input type="number" min="0" step="0.01" value={dev.energy_kwh}
                onchange={(e) => set(dev, 'energy_kwh', Number(e.currentTarget.value))} /></label>
            {/if}
          </div>
          {#if r.best && r.eur !== null}
            {@const save = r.eur - r.best.eur}
            <p class="small best">
              {#if save >= 0.005}
                <span>
                  {#if screen.narrow}
                    Halvin {fmtEur(r.best.eur)} (−{fmtEur(save)})
                  {:else}
                    Halvin aloitus {isToday ? 'loppupäivänä' : 'tänä päivänä'} <b>klo {hhmm(r.best.t)}</b>: {fmtEur(r.best.eur)}
                    (säästö {fmtEur(save)})
                  {/if}
                </span>
                <button type="button" title="Siirrä aloitus halvimpaan aikaan" onclick={() => set(dev, 'start', hhmm(r.best.t))}>{screen.narrow ? `Siirrä klo ${hhmm(r.best.t)}` : 'Siirrä'}</button>
              {:else}<span class="pill">valittu aika on halvin</span>{/if}
            </p>
          {:else if r.eur === null}
            <p class="small muted best">Kaikkia käyttöajan hintoja ei vielä tiedetä.</p>
          {/if}
        {/if}
      </div>
    {/each}
    {#if selected.length}
      <details class="small muted sources">
        <summary>Valittujen laitteiden tiedot ja lähteet</summary>
        <dl>
          {#each selected as dev (dev.id)}
            <dt>{dev.name}</dt>
            <dd>
              {#if dev.notes}<p>{dev.notes}</p>{/if}
              {#if dev.sources?.length}
                <ul>
                  {#each dev.sources as s}
                    <li>{#if s.url}<a href={s.url} target="_blank" rel="noopener">{s.name}</a>{:else}{s.name}{/if}</li>
                  {/each}
                </ul>
              {:else if !dev.notes}<p>Ei lähdetietoja.</p>{/if}
            </dd>
          {/each}
        </dl>
      </details>
    {/if}
  </div>

  <div class="picker-col">
    <h3>{screen.narrow ? 'Lisää tai poista laitteita' : 'Valitse laitteet'}</h3>
    {#each categories as cat (cat)}
      {@const n = countIn(cat)}
      <details class="cat" open={!screen.narrow}>
        <summary><span>{cat}</span>{#if n}<span class="pill">{n} valittu</span>{/if}</summary>
        {#each all.filter((d) => d.category === cat) as dev (dev.id)}
          <label class="pick" title={dev.notes ?? ''}>
            <input type="checkbox" checked={!!selection[dev.id]} onchange={(e) => toggle(dev, e.currentTarget.checked)} />
            <span class="pname">{dev.name}</span>
            <span class="muted small spec">{spec(dev)}</span>
            {#if dev.custom}<button class="x" type="button" title="Poista laite" onclick={() => removeCustom(dev)}>🗑</button>{/if}
          </label>
        {/each}
      </details>
    {/each}

    <details class="add">
      <summary><b>+ Lisää oma laite</b></summary>
      <form onsubmit={addCustom}>
        <label class="field">Nimi <input bind:value={form.name} placeholder="esim. Akkuporakoneen laturi" /></label>
        <div class="row">
          <label class="field">Ilmoitan
            <select bind:value={form.kind}>
              <option value="power">tehon (kW)</option>
              <option value="cycle">energian / käyttökerta (kWh)</option>
            </select>
          </label>
          {#if form.kind === 'power'}
            <label class="field">Teho, kW <input type="number" min="0" step="0.01" bind:value={form.power_kw} /></label>
          {:else}
            <label class="field">Energia, kWh <input type="number" min="0" step="0.01" bind:value={form.energy_kwh} /></label>
          {/if}
        </div>
        <div class="row">
          <label class="field">Käyttöaika, min <input type="number" min="1" step="1" bind:value={form.duration_min} /></label>
          <label class="field">Oletusaloitus <input type="time" step="900" bind:value={form.default_start} /></label>
        </div>
        {#if formError}<p class="error small">{formError}</p>{/if}
        <button class="primary" type="submit">Lisää laite</button>
        <p class="muted small">Omat laitteet tallentuvat tähän selaimeen.</p>
      </form>
    </details>
  </div>
</div>

<style>
  .devices { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(320px, 1.2fr); gap: 1.5rem; }
  .picker-col { order: -1; }   /* leveällä näytöllä valinta vasemmalla */
  @media (max-width: 640px) {
    .devices { grid-template-columns: 1fr; gap: .8rem; }
    .picker-col { order: 0; }  /* puhelimessa valitut ensin, luettelo alla */
  }
  details.cat { border: 1px solid var(--border); border-radius: 8px; margin: 0 0 .5rem; padding: .35rem .7rem; }
  details.cat > summary { display: flex; gap: .5rem; align-items: center; color: var(--muted); padding: .15rem 0; }
  details.cat[open] > summary { margin-bottom: .2rem; }
  details.cat > summary { list-style: none; cursor: pointer; }
  details.cat > summary::-webkit-details-marker { display: none; }
  details.cat > summary::before { content: '▸'; display: inline-block; width: .8rem; color: var(--muted); }
  details.cat[open] > summary::before { content: '▾'; }
  .pick { display: flex; gap: .45rem; align-items: center; padding: .3rem 0; }
  .pick input { flex: none; width: 1.1rem; height: 1.1rem; }
  .pname { flex: 1; min-width: 0; }
  .spec { white-space: nowrap; }
  .x { padding: 0 .45rem; line-height: 1.5; }
  .dev { border-bottom: 1px solid var(--border); padding: .6rem 0; }
  .dev-head { display: flex; flex-wrap: wrap; gap: .2rem .6rem; align-items: baseline; }
  .dev-head .name { flex: 1 1 12rem; }
  .dev-head .cost { margin-left: auto; }
  .fields { margin-top: .35rem; gap: .4rem; }
  .fields .field input { width: 6.5rem; }
  @media (max-width: 640px) {
    .fields { display: grid; grid-template-columns: repeat(3, 1fr); }
    .fields .field input { width: 100%; }
  }
  .best { margin: .35rem 0 0; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .best button { padding: .15rem .6rem; }
  @media (max-width: 640px) {
    .best { flex-wrap: nowrap; justify-content: space-between; }
    .best > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .best button { flex: none; }
  }
  .add form { display: grid; gap: .5rem; margin-top: .5rem; }
  .sources { margin-top: .6rem; }
  .sources dl { margin: .4rem 0; }
  .sources dt { font-weight: 600; color: var(--text); margin-top: .5rem; }
  .sources dd { margin: .1rem 0 0 0; }
  .sources p { margin: .1rem 0; }
  ul { margin: .2rem 0; padding-left: 1.1rem; }
</style>
