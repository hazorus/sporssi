"""Flask-sovellus: JSON-rajapinta käyttöliittymälle. Kaikki reitit ovat /api/-alla."""

import json
from datetime import date

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

    @app.after_request
    def headers(resp):
        if cfg.cors_origin:
            resp.headers["Access-Control-Allow-Origin"] = cfg.cors_origin
        resp.headers.setdefault("Cache-Control", "no-cache")
        return resp

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
        return jsonify({
            "date": day.isoformat(),
            "area": cfg.area,
            "unit": "c/kWh, ALV 0 %",
            "resolution_min": 15,
            "complete": all(s["price"] is not None for s in slots),
            "slots": slots,
        })

    @app.get("/api/health")
    def api_health():
        conn = get_db()
        n_prices = conn.execute("SELECT COUNT(*) FROM prices").fetchone()[0]
        n_devices = conn.execute("SELECT COUNT(*) FROM devices").fetchone()[0]
        last = conn.execute("SELECT kind, target, status, detail, at FROM fetch_log "
                            "ORDER BY id DESC LIMIT 5").fetchall()
        return jsonify({
            "ok": True,
            "price_source": cfg.price_source,
            "entsoe_token": bool(cfg.entsoe_token),
            "db": cfg.db_path,
            "prices_rows": n_prices,
            "devices": n_devices,
            "available": prices.available_days(conn, cfg.area),
            "recent_fetches": [dict(r) for r in last],
        })

    @app.get("/api/stats")
    def api_stats():
        days = min(max(int(request.args.get("days", 365)), 7), 3660)
        conn = get_db()
        return jsonify({
            "days": days,
            "source": cfg.price_source,
            "unit": "c/kWh, ALV 0 %",
            "stats": prices.stats(conn, cfg.area, days),
            "available": prices.available_days(conn, cfg.area),
        })

    @app.get("/api/devices")
    def api_devices():
        rows = get_db().execute("SELECT * FROM devices ORDER BY sort_order").fetchall()
        return jsonify([
            {
                "id": r["id"], "name": r["name"], "category": r["category"], "kind": r["kind"],
                "energy_kwh": r["energy_kwh"], "power_kw": r["power_kw"],
                "duration_min": r["duration_min"], "annual_kwh": r["annual_kwh"],
                "profile": _loads(r["profile"]), "default_start": r["default_start"],
                "shiftable": bool(r["shiftable"]), "notes": r["notes"],
                "sources": _loads(r["sources"], []),
            }
            for r in rows
        ])

    @app.get("/api/heating/options")
    def api_heating_options():
        conn = get_db()
        return jsonify({
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
        })

    @app.get("/api/weather")
    def api_weather():
        day = parse_day(request.args.get("date"))
        conn = get_db()
        location = _location(conn, request.args.get("location", "helsinki"))
        if cfg.lazy_fetch:
            heating.ensure_weather(conn, location, day)
        return jsonify({"date": day.isoformat(), "location": location["id"],
                        "hours": heating.weather_day(conn, location["id"], day)})

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
        return jsonify(result)

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
