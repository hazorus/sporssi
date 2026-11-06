// localStorage voi puuttua tai heittää virheen (yksityinen selaus) -> sivu toimii silti.
export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function loadList(key) {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ei tallennusta */ }
}

// Kuten load, mutta tallennettua arvoa ei yhdistetä oletukseen (esim. laitevalinnat:
// käyttäjän poistamat oletuslaitteet eivät saa palata).
export function loadOr(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
