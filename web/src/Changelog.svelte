<script>
  import { CHANGELOG } from './changelog.js';

  const dateFmt = new Intl.DateTimeFormat('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric' });
  const fmt = (iso) => dateFmt.format(new Date(`${iso}T12:00:00Z`));
</script>

<a class="skip" href="#sisalto">Siirry sisältöön</a>
<div class="wrap">
  <header class="head">
    <p><a href="./">← Takaisin Spörssiin</a></p>
    <h1>Spörssin muutoshistoria</h1>
  </header>
  <main id="sisalto" tabindex="-1">
    {#each CHANGELOG as v (v.version)}
      <section class="card" aria-labelledby="v-{v.version}">
        <h2 id="v-{v.version}">Versio {v.version} <span class="muted date">({fmt(v.date)})</span></h2>
        {#each v.sections as sec (sec.title)}
          <h3>{sec.title}</h3>
          <ul>
            {#each sec.items as item}<li>{item}</li>{/each}
          </ul>
        {/each}
      </section>
    {/each}
  </main>
</div>

<style>
  .head h1 { margin: .2rem 0 1rem; }
  .date { font-weight: normal; }
  h3 { margin-top: 1rem; }
  ul { margin: .3rem 0 0; padding-left: 1.3rem; }
</style>
