"""Ilmatieteen laitoksen avoin data (opendata.fmi.fi, WFS, ei avainta).

- havainnot: fmi::observations::weather::simple, parametri t2m
- ennuste:   fmi::forecast::edited::weather::scandinavia::point::simple, parametri Temperature
"""

import math
import urllib.parse
import xml.etree.ElementTree as ET

from . import http_get
from ..timeutil import iso_utc, parse_iso

NAME = "fmi"
BASE_URL = "https://opendata.fmi.fi/wfs"
NS = {"BsWfs": "http://xml.fmi.fi/schema/wfs/2.0"}


def parse_simple(xml_bytes):
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
        rows.append((parse_iso(t), value))
    return rows


def _query(stored_query, place, parameter, start_utc, end_utc):
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "getFeature",
        "storedquery_id": stored_query,
        "place": place,
        "parameters": parameter,
        "timestep": "60",
        "starttime": iso_utc(start_utc),
        "endtime": iso_utc(end_utc),
    }
    return parse_simple(http_get(BASE_URL + "?" + urllib.parse.urlencode(params)))


def fetch_observations(place, start_utc, end_utc):
    # Havaintokysely sallii enintään 168 h kerrallaan.
    rows, t = [], start_utc
    while t < end_utc:
        chunk_end = min(end_utc, t + 168 * 3600)
        rows += _query("fmi::observations::weather::simple", place, "t2m", t, chunk_end)
        t = chunk_end
    return rows


def fetch_forecast(place, start_utc, end_utc):
    return _query("fmi::forecast::edited::weather::scandinavia::point::simple",
                  place, "Temperature", start_utc, end_utc)
