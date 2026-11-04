"""Säätiedot ja sähkölämmityksen tarpeen arvio.

Malli (astelukumenetelmä, yksinkertaistettu):
  lämpöhäviökerroin H = vuotuinen lämmitystarve / (lämmitystarveluku S17 * 24)   [kWh / (K h)]
  tunnin lämmitystarve = H * max(0, T_raja - T_ulko),  T_raja = 17 °C + (sisälämpö - 21 °C)
  sähkö = tarve * kattavuus / COP(T_ulko) + tarve * (1 - kattavuus)
Raja 17 °C vastaa lämmitystarveluvun määritelmää: sisätilojen ilmaislämpö (ihmiset,
laitteet, aurinko) kattaa lämmityksen 21 °C:n ja 17 °C:n välillä.
"""

import json
import time
from datetime import datetime, timedelta, timezone

from . import db
from .sources import fmi
from .timeutil import HEL, iso_utc, local_day_bounds, today_local

WEATHER_REFRESH = 60 * 60


def _loads(text, default=None):
    return json.loads(text) if text else default


def get_location(conn, location_id):
    row = conn.execute("SELECT * FROM locations WHERE id = ?", (location_id,)).fetchone()
    if not row:
        raise KeyError(location_id)
    return row


def refresh_weather(conn, location, now=None, past_hours=48, forecast_days=10):
    """Hakee havainnot viimeisiltä tunneilta ja ennusteen eteenpäin."""
    now_ts = int(now or time.time())
    now_ts -= now_ts % 3600
    target = location["id"]
    try:
        obs = fmi.fetch_observations(location["fmi_place"], now_ts - past_hours * 3600, now_ts + 3600)
        db.upsert_weather(conn, location["id"], "obs", obs)
        fc = fmi.fetch_forecast(location["fmi_place"], now_ts, now_ts + forecast_days * 86400)
        db.upsert_weather(conn, location["id"], "fc", fc)
        db.log_fetch(conn, "weather", target, "fmi", "ok", f"obs {len(obs)}, fc {len(fc)}")
    except Exception as exc:
        db.log_fetch(conn, "weather", target, "fmi", "error", str(exc)[:500])
        raise


def fetch_past_day(conn, location, day):
    start, end = local_day_bounds(day)
    target = f"{location['id']}:{day.isoformat()}"
    try:
        obs = fmi.fetch_observations(location["fmi_place"], start, end)
        db.upsert_weather(conn, location["id"], "obs", obs)
        db.log_fetch(conn, "weather", target, "fmi", "ok", f"obs {len(obs)}")
    except Exception as exc:
        db.log_fetch(conn, "weather", target, "fmi", "error", str(exc)[:500])
        raise


def ensure_weather(conn, location, day, now=None):
    today = today_local(now)
    try:
        if day >= today - timedelta(days=1):
            last = db.last_fetch_at(conn, "weather", location["id"])
            if not last or time.time() - last > WEATHER_REFRESH:
                refresh_weather(conn, location, now)
        else:
            start, end = local_day_bounds(day)
            n = conn.execute(
                "SELECT COUNT(*) FROM weather WHERE location_id = ? AND kind = 'obs' "
                "AND time_utc >= ? AND time_utc < ?", (location["id"], start, end)).fetchone()[0]
            last = db.last_fetch_at(conn, "weather", f"{location['id']}:{day.isoformat()}")
            if n < (end - start) // 3600 - 1 and (not last or time.time() - last > WEATHER_REFRESH):
                fetch_past_day(conn, location, day)
    except Exception:
        pass


def hourly_temperatures(conn, location_id, day):
    """{tunnin alku utc: (lämpötila, 'obs'|'fc')}; havainto voittaa ennusteen."""
    start, end = local_day_bounds(day)
    rows = conn.execute(
        "SELECT time_utc, kind, temperature FROM weather WHERE location_id = ? "
        "AND time_utc >= ? AND time_utc < ? ORDER BY kind ASC",  # fc < obs -> havainto voittaa
        (location_id, start, end),
    ).fetchall()
    out = {}
    for r in rows:
        out[r["time_utc"] - r["time_utc"] % 3600] = (r["temperature"], r["kind"])
    return out


def cop_at(curve, temp):
    pts = sorted(curve)
    if temp <= pts[0][0]:
        return pts[0][1]
    if temp >= pts[-1][0]:
        return pts[-1][1]
    for (t0, c0), (t1, c1) in zip(pts, pts[1:]):
        if t0 <= temp <= t1:
            return c0 + (c1 - c0) * (temp - t0) / (t1 - t0)
    return pts[-1][1]


def heat_loss_coefficient(annual_heat_kwh, degree_days):
    return annual_heat_kwh / (degree_days * 24.0)


def electricity_for_hour(system, heat_kwh, temp):
    curve = _loads(system["cop_curve"], [[0, 1]])
    min_temp = system["min_temp"]
    coverage = system["coverage"]
    if heat_kwh <= 0:
        return 0.0, None
    if min_temp is not None and temp < min_temp:
        return heat_kwh, 1.0
    cop = cop_at(curve, temp)
    return heat_kwh * coverage / cop + heat_kwh * (1 - coverage), cop


def estimate_day(conn, day, location_id, system_id, area_m2=None, era_id=None,
                 annual_heat_kwh=None, indoor_temp=21.0):
    location = get_location(conn, location_id)
    system = conn.execute("SELECT * FROM heating_systems WHERE id = ?", (system_id,)).fetchone()
    if not system:
        raise KeyError(system_id)
    if annual_heat_kwh is None:
        era = conn.execute("SELECT * FROM building_eras WHERE id = ?", (era_id,)).fetchone()
        if not era or not area_m2:
            raise ValueError("Anna joko vuotuinen lämmitystarve tai pinta-ala ja rakennusvuosi")
        annual_heat_kwh = era["kwh_m2_a"] * float(area_m2)
    h = heat_loss_coefficient(float(annual_heat_kwh), location["degree_days"])
    base = 17.0 + (float(indoor_temp) - 21.0)
    temps = hourly_temperatures(conn, location_id, day)
    start, end = local_day_bounds(day)
    hours = []
    total_heat = total_elec = 0.0
    for t in range(start, end, 3600):
        if t not in temps:
            hours.append({"start": iso_utc(t), "temp": None, "kind": None,
                          "heat_kwh": None, "elec_kwh": None, "cop": None})
            continue
        temp, kind = temps[t]
        heat = h * max(0.0, base - temp)
        elec, cop = electricity_for_hour(system, heat, temp)
        total_heat += heat
        total_elec += elec
        hours.append({"start": iso_utc(t), "temp": round(temp, 1), "kind": kind,
                      "heat_kwh": round(heat, 4), "elec_kwh": round(elec, 4),
                      "cop": None if cop is None else round(cop, 2)})
    return {
        "date": day.isoformat(),
        "location": location["id"],
        "system": system["id"],
        "annual_heat_kwh": round(float(annual_heat_kwh)),
        "heat_loss_kwh_per_kh": round(h, 4),
        "base_temp": base,
        "hours": hours,
        "total_heat_kwh": round(total_heat, 2),
        "total_elec_kwh": round(total_elec, 2),
        "complete": all(x["temp"] is not None for x in hours),
    }


def weather_day(conn, location_id, day):
    temps = hourly_temperatures(conn, location_id, day)
    start, end = local_day_bounds(day)
    return [
        {"start": iso_utc(t), "temp": temps[t][0] if t in temps else None,
         "kind": temps[t][1] if t in temps else None}
        for t in range(start, end, 3600)
    ]
