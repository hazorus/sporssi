"""Hinta- ja säälähteet. Jokainen hintalähde palauttaa listan
(start_utc, resolution_min, price_eur_mwh) -tupleja, hinnat ALV 0 %."""

import urllib.request

USER_AGENT = "sporssi/1.0 (+https://github.com/hazorus/sporssi)"


def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def get_price_source(name):
    if name == "entsoe":
        from . import entsoe
        return entsoe
    if name == "sahkotin":
        from . import sahkotin
        return sahkotin
    raise ValueError(f"Tuntematon hintalähde: {name}")
