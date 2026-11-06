import time
from datetime import date, datetime, timedelta, timezone

import pytest

from sporssi import create_app, db, heating, prices
from sporssi.config import Config
from sporssi.sources import entsoe, fmi
from sporssi.timeutil import local_day_bounds, parse_iso

ENTSOE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<Publication_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3">
  <TimeSeries>
    <Period>
      <timeInterval><start>2026-11-03T23:00Z</start><end>2026-11-04T00:00Z</end></timeInterval>
      <resolution>PT15M</resolution>
      <Point><position>1</position><price.amount>10.5</price.amount></Point>
      <Point><position>2</position><price.amount>-1</price.amount></Point>
      <Point><position>4</position><price.amount>20</price.amount></Point>
    </Period>
  </TimeSeries>
</Publication_MarketDocument>"""

FMI_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:BsWfs="http://xml.fmi.fi/schema/wfs/2.0">
  <wfs:member><BsWfs:BsWfsElement>
    <BsWfs:Time>2026-11-04T20:00:00Z</BsWfs:Time><BsWfs:ParameterName>t2m</BsWfs:ParameterName>
    <BsWfs:ParameterValue>-3.5</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>
  <wfs:member><BsWfs:BsWfsElement>
    <BsWfs:Time>2026-11-04T21:00:00Z</BsWfs:Time><BsWfs:ParameterName>t2m</BsWfs:ParameterName>
    <BsWfs:ParameterValue>NaN</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>
</wfs:FeatureCollection>"""


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "t.sqlite3"))
    db.init_db(c)
    db.ensure_reference_data(c, Config().reference_data)
    return c


def test_entsoe_parse_fills_a03_gaps():
    rows = entsoe.parse_document(ENTSOE_XML)
    start = parse_iso("2026-11-03T23:00:00Z")
    assert rows == [(start, 15, 10.5), (start + 900, 15, -1.0),
                    (start + 1800, 15, -1.0), (start + 2700, 15, 20.0)]


def test_fmi_parse_skips_nan():
    assert fmi.parse_simple(FMI_XML) == [(parse_iso("2026-11-04T20:00:00Z"), -3.5)]


def test_day_bounds_dst():
    s, e = local_day_bounds(date(2026, 3, 29))
    assert (e - s) // 3600 == 23
    s, e = local_day_bounds(date(2026, 10, 25))
    assert (e - s) // 3600 == 25


def test_hourly_prices_expand_and_quarters_override(conn):
    day = date(2025, 9, 30)
    start, end = local_day_bounds(day)
    db.upsert_prices(conn, "FI", [(t, 60, 100.0) for t in range(start, end, 3600)], "test")
    slots = prices.day_slots(conn, "FI", day)
    assert len(slots) == 96 and all(s["price"] == 10.0 for s in slots)
    db.upsert_prices(conn, "FI", [(start, 15, 50.0)], "test")
    assert prices.day_slots(conn, "FI", day)[0]["price"] == 5.0
    assert prices.day_is_complete(conn, "FI", day)


def test_stats_time_weighted(conn):
    now = int(datetime(2026, 11, 4, 12, tzinfo=timezone.utc).timestamp())
    db.upsert_prices(conn, "FI", [(now - 7200, 60, 100.0)], "test")         # 4 varttia á 10 c
    db.upsert_prices(conn, "FI", [(now - 3600 + i * 900, 15, 20.0) for i in range(4)], "test")
    st = prices.stats(conn, "FI", days=7, now=now)
    assert st["slots"] == 8
    assert st["mean"] == pytest.approx(6.0)
    assert st["std"] == pytest.approx(4.0)


def test_cop_and_heating_estimate(conn):
    assert heating.cop_at([[-10, 2], [10, 4]], 0) == pytest.approx(3)
    assert heating.cop_at([[-10, 2], [10, 4]], -30) == 2
    day = date(2026, 11, 4)
    start, end = local_day_bounds(day)
    db.upsert_weather(conn, "helsinki", "fc", [(t, 7.0) for t in range(start, end, 3600)])
    db.upsert_weather(conn, "helsinki", "obs", [(start, -3.0)])
    r = heating.estimate_day(conn, day, "helsinki", "suora", annual_heat_kwh=3689 * 24)
    assert r["heat_loss_kwh_per_kh"] == pytest.approx(1.0)
    assert r["hours"][0]["temp"] == -3.0 and r["hours"][0]["kind"] == "obs"
    assert r["hours"][0]["elec_kwh"] == pytest.approx(20.0)
    assert r["total_heat_kwh"] == pytest.approx(20 + 23 * 10)
    ilp = heating.estimate_day(conn, day, "helsinki", "ilp", annual_heat_kwh=3689 * 24)
    assert ilp["total_elec_kwh"] < r["total_elec_kwh"]


def test_api(tmp_path):
    app = create_app(Config(db_path=str(tmp_path / "a.sqlite3"), lazy_fetch=False))
    c = app.test_client()
    assert len(c.get("/api/devices").get_json()) > 20
    opts = c.get("/api/heating/options").get_json()
    assert {s["id"] for s in opts["systems"]} >= {"suora", "ilp", "mlp", "ivlp"}
    r = c.get("/api/prices?date=2026-11-04").get_json()
    assert len(r["slots"]) == 96 and r["complete"] is False
    assert c.get("/api/prices?date=xx").status_code == 400
    assert c.get("/api/stats").get_json()["stats"] is None
    assert c.get("/api/heating?system=ilp").status_code == 400


def test_geo_location_nearest_and_bounds(conn):
    loc = heating.get_location(conn, "geo:60.21,24.66")
    assert loc["id"] == "geo:60.2,24.7"
    assert loc["nearest_id"] == "espoo" and loc["degree_days"] == 3689
    with pytest.raises(ValueError):
        heating.get_location(conn, "geo:48.9,2.3")
    with pytest.raises(KeyError):
        heating.get_location(conn, "geo:abc")


def test_nearest_station_series():
    rows = [((60.0, 25.0), 1, 1.0), ((60.2, 24.7), 1, 2.0), ((60.2, 24.7), 2, 3.0)]
    assert fmi.nearest_station_series(rows, 60.21, 24.66) == [(1, 2.0), (2, 3.0)]


def test_heating_geo_estimate(conn):
    day = date(2026, 11, 4)
    start, end = local_day_bounds(day)
    db.upsert_weather(conn, "geo:62.6,29.8", "fc", [(t, 0.0) for t in range(start, end, 3600)])
    r = heating.estimate_day(conn, day, "geo:62.6,29.8", "suora", annual_heat_kwh=4755 * 24)
    assert r["nearest_name"] == "Joensuu" and r["total_heat_kwh"] == pytest.approx(17 * 24)


def test_api_heating_geo(tmp_path):
    app = create_app(Config(db_path=str(tmp_path / "g.sqlite3"), lazy_fetch=False))
    c = app.test_client()
    r = c.get("/api/heating?date=2026-11-04&location=geo:61.45,23.86&system=suora&annual_kwh=10000")
    assert r.status_code == 200, r.get_json()
    d = r.get_json()
    assert d["location"] == "geo:61.5,23.9" and d["nearest_name"] == "Tampere"
    assert c.get("/api/heating?location=geo:40.0,10.0&system=suora&annual_kwh=1").status_code == 400


def test_http_cache_headers_and_etag(tmp_path):
    app = create_app(Config(db_path=str(tmp_path / "c.sqlite3"), lazy_fetch=False))
    c = app.test_client()
    conn = db.connect(str(tmp_path / "c.sqlite3"))
    past = date(2026, 1, 15)
    start, end = local_day_bounds(past)
    db.upsert_prices(conn, "FI", [(t, 15, 50.0) for t in range(start, end, 900)], "test")
    r = c.get("/api/prices?date=2026-01-15")
    assert r.get_json()["complete"] is True
    assert "max-age=2592000" in r.headers["Cache-Control"]
    etag = r.headers["ETag"]
    r2 = c.get("/api/prices?date=2026-01-15", headers={"If-None-Match": etag})
    assert r2.status_code == 304
    # keskeneräinen mennyt päivä (aukko tiedoissa): ei muutu -> 1 vrk
    r3 = c.get("/api/prices?date=2026-01-16")
    assert "max-age=86400" in r3.headers["Cache-Control"]
    assert "max-age=3600" in c.get("/api/devices").headers["Cache-Control"]
    assert c.get("/api/health").headers["Cache-Control"] == "no-store"


def test_stats_cache_invalidates_on_new_prices(tmp_path):
    app = create_app(Config(db_path=str(tmp_path / "s.sqlite3"), lazy_fetch=False))
    c = app.test_client()
    conn = db.connect(str(tmp_path / "s.sqlite3"))
    now = int(time.time())
    db.upsert_prices(conn, "FI", [(now - 7200 + i * 900, 15, 100.0) for i in range(4)], "test")
    assert c.get("/api/stats").get_json()["stats"]["mean"] == 10.0
    assert c.get("/api/stats").get_json()["stats"]["mean"] == 10.0  # välimuistista
    # historia vajaa -> uudet hinnat päivittävät tilaston heti
    db.upsert_prices(conn, "FI", [(now - 3600 + i * 900, 15, 300.0) for i in range(4)], "test")
    r = c.get("/api/stats")
    assert r.get_json()["stats"]["mean"] == 20.0
    age = int(r.headers["Cache-Control"].split("max-age=")[1])
    assert 60 <= age <= 25 * 3600  # keskiyöhön asti


def test_incomplete_future_day_cached_until_publish(tmp_path, monkeypatch):
    from sporssi import app as app_module
    app = create_app(Config(db_path=str(tmp_path / "f.sqlite3"), lazy_fetch=False))
    c = app.test_client()
    tomorrow = (app_module.today_local() + timedelta(days=1)).isoformat()
    r = c.get(f"/api/prices?date={tomorrow}")
    age = int(r.headers["Cache-Control"].split("max-age=")[1])
    now = datetime.now(app_module.HEL)
    publish = now.replace(hour=14, minute=0, second=0, microsecond=0)
    expected = int((publish - now).total_seconds())
    if expected > 60:
        assert abs(age - expected) <= 2
    else:
        assert age == 300


def test_lazy_fetch_limits(tmp_path, monkeypatch):
    from sporssi import prices as pr, heating as ht
    conn = db.connect(str(tmp_path / "l.sqlite3"))
    db.init_db(conn)
    db.ensure_reference_data(conn, Config().reference_data)
    calls = []
    monkeypatch.setattr(pr, "fetch_range", lambda *a, **k: calls.append(a) or 0)
    cfg = Config(db_path=":memory:")
    today = pr.today_local()
    pr.ensure_day(conn, cfg, today - timedelta(days=30))   # liian vanha: ei haeta
    assert calls == []
    pr.ensure_day(conn, cfg, today - timedelta(days=2))
    assert len(calls) == 1
    # budjetti täynnä: ei hakuja
    for i in range(db.FETCH_BUDGET):
        db.log_fetch(conn, "prices", f"x{i}", "test", "ok")
    pr.ensure_day(conn, cfg, today - timedelta(days=3))
    assert len(calls) == 1
    wcalls = []
    monkeypatch.setattr(ht, "refresh_weather", lambda *a, **k: wcalls.append(a))
    ht.ensure_weather(conn, ht.get_location(conn, "helsinki"), today)
    assert wcalls == []


def test_api_bad_days_and_health(tmp_path):
    app = create_app(Config(db_path=str(tmp_path / "h.sqlite3"), lazy_fetch=False))
    c = app.test_client()
    assert c.get("/api/stats?days=abc").status_code == 400
    h = c.get("/api/health")
    assert "db" not in h.get_json() and h.headers["X-Content-Type-Options"] == "nosniff"
