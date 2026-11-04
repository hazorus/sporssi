"""sahkotin.fi - vapaa rajapinta Suomen spot-hinnoille (€/MWh, ALV 0 %).

Parametri `quarter` palauttaa 15 minuutin hinnat (1.10.2025 alkaen), ilman sitä tuntihinnat.
Ennen 15 minuutin markkinaa olevat jaksot tallennetaan tuntihintoina.
"""

import json
import urllib.parse

from . import http_get
from ..timeutil import iso_utc, parse_iso

NAME = "sahkotin"
BASE_URL = "https://sahkotin.fi/prices"
QUARTER_START = parse_iso("2025-09-30T22:00:00Z")  # 1.10.2025 00:00 Suomen aikaa


def _query(start_utc, end_utc, quarter):
    params = {"start": iso_utc(start_utc).replace("Z", ".000Z"),
              "end": iso_utc(end_utc).replace("Z", ".000Z")}
    url = BASE_URL + ("?quarter&" if quarter else "?") + urllib.parse.urlencode(params)
    data = json.loads(http_get(url))
    return [(parse_iso(p["date"]), float(p["value"])) for p in data.get("prices", [])
            if p.get("value") is not None]


def fetch_prices(start_utc, end_utc, area="FI", token=None):
    if area != "FI":
        raise ValueError("sahkotin.fi tukee vain aluetta FI")
    rows = []
    if start_utc < QUARTER_START:
        hour_end = min(end_utc, QUARTER_START)
        rows += [(t, 60, v) for t, v in _query(start_utc, hour_end, quarter=False)
                 if start_utc <= t < hour_end]
    if end_utc > QUARTER_START:
        q_start = max(start_utc, QUARTER_START)
        rows += [(t, 15, v) for t, v in _query(q_start, end_utc, quarter=True)
                 if q_start <= t < end_utc]
    return rows
