// Verkon tila: näytetäänkö välimuistista (service worker) tallennettuja tietoja.
let offline = $state(false);
let storedAt = $state(null);

export const net = {
  get offline() { return offline; },
  get storedAt() { return storedAt; },
};

export function markResponse(res) {
  if (res.headers.get('x-sporssi-offline')) {
    offline = true;
    const t = Number(res.headers.get('x-sporssi-stored')) || null;
    if (t && (!storedAt || t < storedAt)) storedAt = t;
  } else if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    offline = false;
    storedAt = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => { offline = true; });
  if (navigator.onLine === false) offline = true;
}

export function markFailure() {
  offline = true;
}
