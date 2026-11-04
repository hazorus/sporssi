"""ENTSO-E Transparency Platform, Day-ahead Prices (documentType A44).

Vaatii tokenin (ENTSOE_TOKEN). Vastaus on XML:ää; puretaan ElementTreellä.
Käyrätyyppi A03: puuttuva position tarkoittaa, että edellinen hinta jatkuu.
"""

import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from . import http_get
from ..timeutil import parse_iso

NAME = "entsoe"
BASE_URL = "https://web-api.tp.entsoe.eu/api"
AREA_CODES = {
    "FI": "10YFI-1--------U",
    "SE3": "10Y1001A1001A46L",
    "EE": "10Y1001A1001A39I",
}
RESOLUTIONS = {"PT15M": 15, "PT30M": 30, "PT60M": 60}


def _fmt(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y%m%d%H%M")


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _children(elem, name):
    return [c for c in elem if _local(c.tag) == name]


def _child(elem, name):
    found = _children(elem, name)
    return found[0] if found else None


def _text(elem, name):
    c = _child(elem, name)
    return c.text.strip() if c is not None and c.text else None


def parse_document(xml_bytes):
    """Purkaa A44-dokumentin listaksi (start_utc, resolution_min, price_eur_mwh)."""
    root = ET.fromstring(xml_bytes)
    if _local(root.tag) == "Acknowledgement_MarketDocument":
        reason = root.find(".//{*}Reason/{*}text")
        text = reason.text if reason is not None else "tuntematon syy"
        if "No matching data" in text:
            return []
        raise RuntimeError(f"ENTSO-E: {text}")
    out = {}
    for ts in _children(root, "TimeSeries"):
        for period in _children(ts, "Period"):
            interval = _child(period, "timeInterval")
            start = parse_iso(_text(interval, "start"))
            end = parse_iso(_text(interval, "end"))
            res = RESOLUTIONS[_text(period, "resolution")]
            step = res * 60
            points = {}
            for pt in _children(period, "Point"):
                points[int(_text(pt, "position"))] = float(_text(pt, "price.amount"))
            n = (end - start) // step
            last = None
            for pos in range(1, n + 1):
                if pos in points:
                    last = points[pos]
                if last is None:
                    continue
                out[(start + (pos - 1) * step, res)] = last
    return sorted((s, r, p) for (s, r), p in out.items())


def fetch_prices(start_utc, end_utc, area="FI", token=None):
    if not token:
        raise RuntimeError("ENTSOE_TOKEN puuttuu")
    code = AREA_CODES[area]
    params = {
        "securityToken": token,
        "documentType": "A44",
        "in_Domain": code,
        "out_Domain": code,
        "contract_MarketAgreement.type": "A01",
        "periodStart": _fmt(start_utc),
        "periodEnd": _fmt(end_utc),
    }
    rows = parse_document(http_get(BASE_URL + "?" + urllib.parse.urlencode(params)))
    return [r for r in rows if start_utc <= r[0] < end_utc]
