"""Flask-sovellus: JSON-rajapinta käyttöliittymälle. Kaikki reitit ovat /api/-alla."""

import json
import threading
import time
from datetime import date, timedelta

from flask import Flask, abort, g, jsonify, request

from . import db, heating, prices
from .config import Config
from .timeutil import today_local


def _loads(text, default=None):
    return json.loads(text) if text else default


def create_app(config=None):
    cfg = config or Config()
    app = Flask(__name__)
    app.config["SPORSSI"] = cfg
    app.json.ensure_ascii = False

    conn = db.connect(cfg.db_path)
    db.init_db(conn)
    db.ensure_reference_data(conn, cfg.reference_data)
    conn.close()

    def get_db():
        if "db" not in g:
            g.db = db.connect(cfg.db_path)
        return g.db

    @app.teardown_appcontext
    def close_db(_exc):
        conn = g.pop("db", None)
        if conn is not None:
            conn.close()

    # HTTP-välimuisti: jokainen GET-vastaus saa ETagin, jolloin selain saa muuttumattomasta
    # vastauksesta lyhyen 304-vastauksen. Muuttumattomat tiedot (menneiden päivien hinnat)
    # saavat pitkän max-age-ajan, jolloin niitä ei kysytä palvelimelta lainkaan.
    YEAR_MONTH = 30 * 86400

    def cache_for(resp, seconds):
        resp.headers["Cache-Control"] = f"public, max-age={seconds}" if seconds > 0 else "no-cache"
        return resp

    @app.after_request
    def headers(resp):
        if cfg.cors_origin:
            resp.headers["Access-Control-Allow-Origin"] = cfg.cors_origin
        resp.headers.setdefault("Cache-Control", "no-cache")
        if request.method == "GET" and resp.status_code == 200 and not resp.direct_passthrough:
            resp.add_etag()
            resp.make_conditional(request)
        return resp

    # 12 kk tilasto lasketaan uudelleen vain, kun hintoja on tullut lisää tai tunti on kulunut.
    stats_cache = {}
    stats_lock = threading.Lock()

    def cached_stats(conn, days):
        stamp = tuple(conn.execute(
            "SELECT COUNT(*), MAX(fetched_at) FROM prices WHERE area = ?", (cfg.area,)).fetchone())
        with stats_lock:
            hit = stats_cache.get(days)
            if hit and hit[0] == stamp and time.time() - hit[1] < 3600:
                return hit[2]
        value = (prices.stats(conn, cfg.area, days), prices.available_days(conn, cfg.area))
        with stats_lock:
            stats_cache[days] = (stamp, time.time(), value)
        return value

    def parse_day(value):
        if not value:
            return today_local()
        try:
            return date.fromisoformat(value)
        except ValueError:
            abort(400, "Päivämäärä muodossa VVVV-KK-PP")

    @app.get("/api/prices")
    def api_prices():
        day = parse_day(request.args.get("date"))
        conn = get_db()
        if cfg.lazy_fetch:
            prices.ensure_day(conn, cfg, day)
        slots = prices.day_slots(conn, cfg.area, day)
        complete = all(s["price"] is not None for s in slots)
        resp = jsonify({
            "date": day.isoformat(),
            "area": cfg.area,
            "unit": "c/kWh, ALV 0 %",
            "resolution_min": 15,
            "complete": complete,
            "slots": slots,
        })
        # Valmis päivä ei enää muutu: menneet päivät 30 vrk, tänään/huomenna 1 h.
        if not complete:
            return cache_for(resp, 0)
        return cache_for(resp, YEAR_MONTH if day < today_local() else 3600)

    @app.get("/api/health")
    def api_health():
        conn = get_db()
        n_prices = conn.execute("SELECT COUNT(*) FROM prices").fetchone()[0]
        n_devices = conn.execute("SELECT COUNT(*) FROM devices").fetchone()[0]
        last = conn.execute("SELECT kind, target, status, detail, at FROM fetch_log "
                            "ORDER BY id DESC LIMIT 5").fetchall()
        resp = jsonify({
            "ok": True,
            "price_source": cfg.price_source,
            "entsoe_token": bool(cfg.entsoe_token),
            "db": cfg.db_path,
            "prices_rows": n_prices,
            "devices": n_devices,
            "available": prices.available_days(conn, cfg.area),
            "recent_fetches": [dict(r) for r in last],
        })
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/api/stats")
    def api_stats():
        days = min(max(int(request.args.get("days", 365)), 7), 3660)
        conn = get_db()
        st, available = cached_stats(conn, days)
        return cache_for(jsonify({
            "days": days,
            "source": cfg.price_source,
            "unit": "c/kWh, ALV 0 %",
            "stats": st,
            "available": available,
        }), 600)

    @app.get("/api/devices")
    def api_devices():
        rows = get_db().execute("SELECT * FROM devices ORDER BY sort_order").fetchall()
        return cache_for(jsonify([
            {
                "id": r["id"], "name": r["name"], "category": r["category"], "kind": r["kind"],
                "energy_kwh": r["energy_kwh"], "power_kw": r["power_kw"],
                "duration_min": r["duration_min"], "annual_kwh": r["annual_kwh"],
                "profile": _loads(r["profile"]), "default_start": r["default_start"],
                "shiftable": bool(r["shiftable"]), "notes": r["notes"],
                "sources": _loads(r["sources"], []),
            }
            for r in rows
        ]), 3600)

    @app.get("/api/heating/options")
    def api_heating_options():
        conn = get_db()
        return cache_for(jsonify({
            "systems": [
                {"id": r["id"], "name": r["name"], "cop_curve": _loads(r["cop_curve"]),
                 "min_temp": r["min_temp"], "coverage": r["coverage"], "notes": r["notes"],
                 "sources": _loads(r["sources"], [])}
                for r in conn.execute("SELECT * FROM heating_systems ORDER BY sort_order")
            ],
            "eras": [
                {"id": r["id"], "label": r["label"], "kwh_m2_a": r["kwh_m2_a"],
                 "sources": _loads(r["sources"], [])}
                for r in conn.execute("SELECT * FROM building_eras ORDER BY sort_order")
            ],
            "locations": [
                {"id": r["id"], "name": r["name"], "degree_days": r["degree_days"],
                 "sources": _loads(r["sources"], [])}
                for r in conn.execute("SELECT * FROM locations ORDER BY sort_order")
            ],
        }), 3600)

    @app.get("/api/weather")
    def api_weather():
        day = parse_day(request.args.get("date"))
        conn = get_db()
        location = _location(conn, request.args.get("location", "helsinki"))
        if cfg.lazy_fetch:
            heating.ensure_weather(conn, location, day)
        return cache_for(jsonify({"date": day.isoformat(), "location": location["id"],
                                  "hours": heating.weather_day(conn, location["id"], day)}),
                         weather_max_age(day))

    @app.get("/api/heating")
    def api_heating():
        a = request.args
        day = parse_day(a.get("date"))
        conn = get_db()
        location = _location(conn, a.get("location", "helsinki"))
        if cfg.lazy_fetch:
            heating.ensure_weather(conn, location, day)

        def num(name):
            v = a.get(name)
            if v in (None, ""):
                return None
            try:
                return float(v)
            except ValueError:
                abort(400, f"{name} ei ole luku")

        try:
            result = heating.estimate_day(
                conn, day, location, a.get("system", "suora"),
                area_m2=num("area"), era_id=a.get("era"),
                annual_heat_kwh=num("annual_kwh"), indoor_temp=num("indoor") or 21.0,
            )
        except KeyError:
            abort(404, "Tuntematon lämmitysjärjestelmä")
        except ValueError as exc:
            abort(400, str(exc))
        return cache_for(jsonify(result), weather_max_age(day))

    def weather_max_age(day):
        # Säähavainnot eivät enää muutu kahden päivän jälkeen; ennusteet päivittyvät tunneittain.
        return 86400 if day < today_local() - timedelta(days=1) else 600

    def _location(conn, location_id):
        try:
            return heating.get_location(conn, location_id)
        except KeyError:
            abort(404, "Tuntematon paikkakunta")
        except ValueError as exc:
            abort(400, str(exc))

    @app.errorhandler(400)
    @app.errorhandler(404)
    def err(e):
        return jsonify({"error": e.description}), e.code

    return app
