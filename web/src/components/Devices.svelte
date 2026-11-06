<script>
  import { deviceEnergy, runCost, bestStart, startMsFor } from '../lib/cost.js';
  import { hhmm, fmtEur, fmtKwh, SLOT_MS } from '../lib/pricing.js';

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

<div class="grid2">
  <div>
    <h3>Valitse laitteet</h3>
    {#each categories as cat (cat)}
      <fieldset>
        <legend>{cat}</legend>
        {#each all.filter((d) => d.category === cat) as dev (dev.id)}
          <label class="pick" title={dev.notes ?? ''}>
            <input type="checkbox" checked={!!selection[dev.id]} onchange={(e) => toggle(dev, e.currentTarget.checked)} />
            {dev.name}
            <span class="muted small">
              {#if dev.kind === 'continuous'}{fmtKwh(dev.annual_kwh)} kWh/v
              {:else if dev.kind === 'cycle'}{fmtKwh(dev.energy_kwh)} kWh/kerta
              {:else}{fmtKwh(dev.power_kw)} kW{/if}
            </span>
            {#if dev.custom}<button class="x" type="button" title="Poista" onclick={() => removeCustom(dev)}>✕</button>{/if}
          </label>
        {/each}
      </fieldset>
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

  <div>
    <h3>Valitut laitteet</h3>
    {#if selected.length === 0}
      <p class="muted">Valitse vasemmalta laitteet, joiden käyttökustannukset haluat nähdä.</p>
    {/if}
    {#each selected as dev (dev.id)}
      {@const r = info(dev)}
      <div class="dev">
        <div class="row">
          <b>{dev.name}</b><span class="spacer"></span>
          <span class="num">{fmtKwh(r.kwh)} kWh{r.continuous ? '/vrk' : ''} · <b>{fmtEur(r.eur)}</b></span>
        </div>
        {#if r.continuous}
          <p class="muted small">Jatkuva kulutus, jaettu tasaisesti vuorokaudelle.
            Vuosikulutus <input type="number" min="0" step="10" value={dev.annual_kwh}
              onchange={(e) => set(dev, 'annual_kwh', Number(e.currentTarget.value))} /> kWh</p>
        {:else}
          <div class="row small">
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
              Halvin aloitus {isToday ? 'loppupäivänä' : 'tänä päivänä'}: <b>klo {hhmm(r.best.t)}</b> → {fmtEur(r.best.eur)}
              {#if save >= 0.005}
                (säästö {fmtEur(save)})
                <button type="button" onclick={() => set(dev, 'start', hhmm(r.best.t))}>Siirrä</button>
              {:else}<span class="pill">valittu aika on halvin</span>{/if}
            </p>
          {:else if r.eur === null}
            <p class="small muted">Kaikkia käyttöajan hintoja ei vielä tiedetä.</p>
          {/if}
        {/if}
        {#if dev.sources?.length}
          <details class="small muted">
            <summary>Lähteet</summary>
            {#if dev.notes}<p>{dev.notes}</p>{/if}
            <ul>
              {#each dev.sources as s}
                <li>{#if s.url}<a href={s.url} target="_blank" rel="noopener">{s.name}</a>{:else}{s.name}{/if}</li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  fieldset { border: 1px solid var(--border); border-radius: 8px; margin: 0 0 .6rem; padding: .3rem .7rem .5rem; }
  legend { font-size: .8rem; color: var(--muted); padding: 0 .3rem; }
  .pick { display: flex; gap: .4rem; align-items: center; padding: .15rem 0; }
  .pick .muted { margin-left: auto; }
  .x { padding: 0 .35rem; font-size: .75rem; }
  .dev { border-bottom: 1px solid var(--border); padding: .55rem 0; }
  .dev .field input { width: 6.5rem; }
  .best { margin: .4rem 0 0; }
  .add form { display: grid; gap: .5rem; margin-top: .5rem; }
  ul { margin: .3rem 0; padding-left: 1.1rem; }
</style>
