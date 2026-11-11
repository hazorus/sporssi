// Svelte-action <details use:persistOpen={'avain'}>: muistaa auki/kiinni-tilan selaimessa.
// Jos tallennettua tilaa ei ole, käytetään elementin omaa oletusta (open-attribuutti).
const PREFIX = 'sporssi.open.';

export function persistOpen(node, key) {
  let k = PREFIX + key;
  const restore = () => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) node.open = v === '1';
    } catch { /* ei tallennusta */ }
  };
  const save = () => {
    try { localStorage.setItem(k, node.open ? '1' : '0'); } catch { /* ei tallennusta */ }
  };
  restore();
  node.addEventListener('toggle', save);
  return {
    update(next) { k = PREFIX + next; restore(); },
    destroy() { node.removeEventListener('toggle', save); },
  };
}
