"""Ilmatieteen laitoksen avoin data (opendata.fmi.fi, WFS, ei avainta).

- havainnot: fmi::observations::weather::simple, parametri t2m
- ennuste:   fmi::forecast::edited::weather::scandinavia::point::simple, parametri Temperature

Paikka annetaan joko nimenä (place) tai koordinaatteina. Havaintokysely ei tue latlon-
parametria, joten koordinaateille haetaan asemat ympäröivästä alueesta (bbox) ja valitaan lähin.
"""

import math
import urllib.parse
import xml.etree.ElementTree as ET

from . import http_get
from ..timeutil import iso_utc, parse_iso

NAME = "fmi"
BASE_URL = "https://opendata.fmi.fi/wfs"
NS = {"BsWfs": "http://xml.fmi.fi/schema/wfs/2.0"}


GML = "{http://www.opengis.net/gml/3.2}"


def parse_simple(xml_bytes, with_pos=False):
    root = ET.fromstring(xml_bytes)
    rows = []
    for el in root.iterfind(".//BsWfs:BsWfsElement", NS):
        t = el.findtext("BsWfs:Time", namespaces=NS)
        v = el.findtext("BsWfs:ParameterValue", namespaces=NS)
        if not t or v is None:
            continue
        try:
            value = float(v)
        except ValueError:
            continue
        if math.isnan(value):
            continue
        if with_pos:
            pos = el.find(f".//{GML}pos")
            lat, lon = (float(x) for x in pos.text.split()[:2])
            rows.append(((lat, lon), parse_iso(t), value))
        else:
            rows.append((parse_iso(t), value))
    return rows


def _dist2(a, b):
    # riittävä etäisyysvertailu pienillä alueilla: pituusaste skaalattuna leveysasteella
    dlat = a[0] - b[0]
    dlon = (a[1] - b[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return dlat * dlat + dlon * dlon


def nearest_station_series(rows, lat, lon):
    """rows: [((lat, lon), t, v)] -> lähimmän aseman [(t, v)]."""
    if not rows:
        return []
    stations = {pos for pos, _, _ in rows}
    best = min(stations, key=lambda p: _dist2(p, (lat, lon)))
    return [(t, v) for pos, t, v in rows if pos == best]


def _query(stored_query, where, parameter, start_utc, end_utc, with_pos=False):
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "getFeature",
        "storedquery_id": stored_query,
        **where,
        "parameters": parameter,
        "timestep": "60",
        "starttime": iso_utc(start_utc),
        "endtime": iso_utc(end_utc),
    }
    return parse_simple(http_get(BASE_URL + "?" + urllib.parse.urlencode(params)), with_pos)


def _obs_chunk(place, lat, lon, start_utc, end_utc):
    q = "fmi::observations::weather::simple"
    if place:
        return _query(q, {"place": place}, "t2m", start_utc, end_utc)
    # Koordinaatit: laajennetaan aluetta, kunnes löytyy asema (n. 20 km, 40 km, 80 km).
    for d in (0.2, 0.4, 0.8):
        dlon = d * 2
        bbox = f"{lon - dlon:.3f},{lat - d:.3f},{lon + dlon:.3f},{lat + d:.3f}"
        rows = _query(q, {"bbox": bbox}, "t2m", start_utc, end_utc, with_pos=True)
        if rows:
            return nearest_station_series(rows, lat, lon)
    return []


def fetch_observations(place, start_utc, end_utc, lat=None, lon=None):
    # Havaintokysely sallii enintään 168 h kerrallaan.
    rows, t = [], start_utc
    while t < end_utc:
        chunk_end = min(end_utc, t + 168 * 3600)
        rows += _obs_chunk(place, lat, lon, t, chunk_end)
        t = chunk_end
    return rows


def fetch_forecast(place, start_utc, end_utc, lat=None, lon=None):
    where = {"place": place} if place else {"latlon": f"{lat:.4f},{lon:.4f}"}
    return _query("fmi::forecast::edited::weather::scandinavia::point::simple",
                  where, "Temperature", start_utc, end_utc)
