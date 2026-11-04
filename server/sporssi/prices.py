"""Hintojen haku, tallennus ja tilastot."""

import math
import time
from datetime import datetime, time as dtime, timedelta

from . import db
from .sources import get_price_source
from .timeutil import HEL, SLOT, iso_utc, local_day_bounds, today_local

PUBLISH_LOCAL = dtime(13, 30)   # huomisen hinnat julkaistaan n. klo 13.45 Suomen aikaa
RETRY_SECONDS = 10 * 60         # saman päivän uudelleenhaun minimiväli


def fetch_range(conn, cfg, start_utc, end_utc):
    """Hakee hinnat lähteestä ja tallentaa ne. Palauttaa tallennettujen rivien määrän."""
    source = get_price_source(cfg.price_source)
    target = f"{cfg.area}:{iso_utc(start_utc)}"
    try:
        rows = source.fetch_prices(start_utc, end_utc, cfg.area, cfg.entsoe_token)
    except Exception as exc:  # verkko- tai lähdevirhe kirjataan, ei kaadeta palvelua
        db.log_fetch(conn, "prices", target, source.NAME, "error", str(exc)[:500])
        raise
    n = db.upsert_prices(conn, cfg.area, rows, source.NAME)
    db.log_fetch(conn, "prices", target, source.NAME, "ok" if n else "empty", f"{n} riviä")
    return n


def _slot_prices(conn, area, start_utc, end_utc):
    """15 min jaksojen hinnat {start: €/MWh}. Varttihinta voittaa tuntihinnan."""
    rows = conn.execute(
        """SELECT start_utc, resolution_min, price_eur_mwh FROM prices
           WHERE area = ? AND start_utc >= ? AND start_utc < ?
           ORDER BY resolution_min DESC""",
        (area, start_utc - 3600, end_utc),
    ).fetchall()
    out = {}
    for r in rows:  # tunnit ensin, sitten vartit päälle
        step = r["resolution_min"] * 60
        for t in range(r["start_utc"], r["start_utc"] + step, SLOT):
            if start_utc <= t < end_utc:
                out[t] = r["price_eur_mwh"]
    return out


def day_is_complete(conn, area, day):
    start, end = local_day_bounds(day)
    return len(_slot_prices(conn, area, start, end)) == (end - start) // SLOT


def ensure_day(conn, cfg, day, now=None):
    """Hakee puuttuvan päivän hinnat, jos järkevää (laiska haku API-pyynnön yhteydessä)."""
    if day_is_complete(conn, cfg.area, day):
        return
    now = now or datetime.now(HEL)
    today = today_local(now)
    if day > today + timedelta(days=1):
        return
    if day == today + timedelta(days=1) and now.astimezone(HEL).time() < PUBLISH_LOCAL:
        return
    start, end = local_day_bounds(day)
    target = f"{cfg.area}:{iso_utc(start)}"
    last = db.last_fetch_at(conn, "prices", target)
    if last and time.time() - last < RETRY_SECONDS:
        return
    try:
        fetch_range(conn, cfg, start, end)
    except Exception:
        pass


def day_slots(conn, area, day):
    start, end = local_day_bounds(day)
    prices = _slot_prices(conn, area, start, end)
    return [
        {"start": iso_utc(t), "price": None if t not in prices else round(prices[t] / 10, 4)}
        for t in range(start, end, SLOT)
    ]


def stats(conn, area, days=365, now=None):
    """Viimeisen `days` vuorokauden aikapainotettu keskihinta ja keskihajonta (c/kWh, ALV 0)."""
    end = int((now or time.time()))
    start = end - days * 86400
    rows = conn.execute(
        """SELECT start_utc, resolution_min, price_eur_mwh FROM prices
           WHERE area = ? AND start_utc >= ? AND start_utc < ?""",
        (area, start, end),
    ).fetchall()
    slots = {}
    for r in sorted(rows, key=lambda r: -r["resolution_min"]):
        for t in range(r["start_utc"], r["start_utc"] + r["resolution_min"] * 60, SLOT):
            if start <= t < end:
                slots[t] = r["price_eur_mwh"] / 10
    if not slots:
        return None
    values = list(slots.values())
    n = len(values)
    mean = sum(values) / n
    std = math.sqrt(sum((v - mean) ** 2 for v in values) / n)
    mad = sum(abs(v - mean) for v in values) / n
    first, last = min(slots), max(slots)
    return {
        "from": iso_utc(first),
        "to": iso_utc(last + SLOT),
        "slots": n,
        "coverage": round(n / ((end - start) // SLOT), 3),
        "mean": round(mean, 3),
        "std": round(std, 3),
        "mean_abs_dev": round(mad, 3),
        "min": round(min(values), 3),
        "max": round(max(values), 3),
    }


def history_start(conn, area):
    row = conn.execute("SELECT MIN(start_utc) AS s FROM prices WHERE area = ?", (area,)).fetchone()
    return row["s"]


def available_days(conn, area):
    row = conn.execute(
        "SELECT MIN(start_utc) AS s, MAX(start_utc) AS e FROM prices WHERE area = ?", (area,)
    ).fetchone()
    if row["s"] is None:
        return None
    return {
        "first": datetime.fromtimestamp(row["s"], HEL).date().isoformat(),
        "last": datetime.fromtimestamp(row["e"], HEL).date().isoformat(),
    }
