<script>
  import { onMount } from 'svelte';

  // Android/Chrome/Edge: selain tarjoaa asennuksen (beforeinstallprompt).
  // iOS Safari: asennus tehdään Jaa-valikosta, joten näytetään ohje.
  let deferred = $state(null);
  let installed = $state(false);
  let showIosHelp = $state(false);
  let ios = $state(false);

  onMount(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) { installed = true; return; }
    const ua = navigator.userAgent;
    ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    const onPrompt = (e) => { e.preventDefault(); deferred = e; };
    const onInstalled = () => { installed = true; deferred = null; };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  async function install() {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') installed = true;
      deferred = null;
    } else if (ios) {
      showIosHelp = !showIosHelp;
    }
  }
</script>

{#if !installed && (deferred || ios)}
  <button type="button" onclick={install} title="Lisää Spörssi puhelimen aloitusnäytölle">📲 Asenna</button>
{/if}
{#if showIosHelp}
  <div class="ios-help card small" role="dialog" aria-label="Asennusohje">
    <b>Lisää Spörssi aloitusnäytölle:</b>
    <ol>
      <li>Avaa sivu <b>Safarilla</b>.</li>
      <li>Napauta <b>Jaa</b>-painiketta (neliö, josta nuoli ylös).</li>
      <li>Valitse <b>Lisää Koti-valikkoon</b> ja napauta <b>Lisää</b>.</li>
    </ol>
    <button type="button" onclick={() => (showIosHelp = false)}>Sulje</button>
  </div>
{/if}

<style>
  .ios-help {
    position: absolute; right: 0; top: calc(100% + .3rem); z-index: 10; max-width: 20rem;
    box-shadow: 0 6px 24px rgba(0, 0, 0, .18);
  }
  ol { margin: .4rem 0 .6rem; padding-left: 1.2rem; }
</style>
