"""SQLite-tietokanta. Kaikki ajat tallennetaan UTC-epoch-sekunteina."""

import json
import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
    area           TEXT    NOT NULL,
    start_utc      INTEGER NOT NULL,          -- jakson alku, UTC epoch s
    resolution_min INTEGER NOT NULL,          -- 15 tai 60
    price_eur_mwh  REAL    NOT NULL,          -- spot-hinta, ALV 0 %
    source         TEXT    NOT NULL,
    fetched_at     INTEGER NOT NULL,
    PRIMARY KEY (area, start_utc, resolution_min)
);

CREATE TABLE IF NOT EXISTS fetch_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT    NOT NULL,              -- prices | weather
    target     TEXT    NOT NULL,              -- esim. FI:2026-11-04 tai helsinki
    source     TEXT    NOT NULL,
    status     TEXT    NOT NULL,              -- ok | empty | error
    detail     TEXT,
    at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fetch_log_target ON fetch_log (kind, target, at);

CREATE TABLE IF NOT EXISTS weather (
    location_id TEXT    NOT NULL,
    time_utc    INTEGER NOT NULL,
    kind        TEXT    NOT NULL,             -- obs = havainto, fc = ennuste
    temperature REAL    NOT NULL,             -- °C
    fetched_at  INTEGER NOT NULL,
    PRIMARY KEY (location_id, time_utc, kind)
);

-- Viitetiedot: ladataan data/reference_data.json -tiedostosta skriptillä,
-- ei päivity automaattisesti.
CREATE TABLE IF NOT EXISTS devices (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL,
    kind          TEXT NOT NULL,              -- cycle | power | continuous
    energy_kwh    REAL,                       -- cycle: kWh / käyttökerta
    power_kw      REAL,                       -- power: keskiteho käytön aikana
    duration_min  INTEGER NOT NULL,           -- oletuskäyttöaika
    annual_kwh    REAL,                       -- continuous: kWh / vuosi
    profile       TEXT,                       -- JSON: suhteelliset painot 15 min jaksoille
    default_start TEXT,                       -- HH:MM
    shiftable     INTEGER NOT NULL DEFAULT 1, -- voiko käyttöä siirtää halvemmalle
    notes         TEXT,
    sources       TEXT,                       -- JSON-lista {name, url, note}
    sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS heating_systems (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    cop_curve   TEXT NOT NULL,                -- JSON [[ulkolämpö °C, COP], ...]
    min_temp    REAL,                         -- tätä kylmemmällä lisävastus (COP 1)
    coverage    REAL NOT NULL DEFAULT 1.0,    -- osuus lämmitystarpeesta, loput suoralla sähköllä
    notes       TEXT,
    sources     TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS building_eras (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    kwh_m2_a    REAL NOT NULL,                -- tilojen lämmitysenergian tarve normaalivuonna
    sources     TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locations (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    fmi_place    TEXT NOT NULL,
    lat          REAL NOT NULL,
    lon          REAL NOT NULL,
    degree_days  REAL NOT NULL,               -- lämmitystarveluku S17, normaalijakso
    sources      TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def connect(path):
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def upsert_prices(conn, area, rows, source):
    """rows: iterable of (start_utc, resolution_min, price_eur_mwh)."""
    now = int(time.time())
    data = [(area, int(s), int(r), float(p), source, now) for s, r, p in rows]
    conn.executemany(
        """INSERT INTO prices (area, start_utc, resolution_min, price_eur_mwh, source, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (area, start_utc, resolution_min) DO UPDATE SET
             price_eur_mwh = excluded.price_eur_mwh,
             source = excluded.source,
             fetched_at = excluded.fetched_at""",
        data,
    )
    conn.commit()
    return len(data)


def log_fetch(conn, kind, target, source, status, detail=None):
    conn.execute(
        "INSERT INTO fetch_log (kind, target, source, status, detail, at) VALUES (?, ?, ?, ?, ?, ?)",
        (kind, target, source, status, detail, int(time.time())),
    )
    conn.commit()


def last_fetch_at(conn, kind, target):
    row = conn.execute(
        "SELECT MAX(at) AS at FROM fetch_log WHERE kind = ? AND target = ?", (kind, target)
    ).fetchone()
    return row["at"] if row and row["at"] else None


def upsert_weather(conn, location_id, kind, rows):
    """rows: iterable of (time_utc, temperature)."""
    now = int(time.time())
    conn.executemany(
        """INSERT INTO weather (location_id, time_utc, kind, temperature, fetched_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (location_id, time_utc, kind) DO UPDATE SET
             temperature = excluded.temperature, fetched_at = excluded.fetched_at""",
        [(location_id, int(t), kind, float(v), now) for t, v in rows],
    )
    conn.commit()


def _dumps(value):
    return None if value is None else json.dumps(value, ensure_ascii=False)


def load_reference_data(conn, data):
    """Korvaa viitetaulujen sisällön annetulla datalla (dict, ks. data/reference_data.json)."""
    with conn:
        conn.execute("DELETE FROM devices")
        for i, d in enumerate(data["devices"]):
            conn.execute(
                """INSERT INTO devices (id, name, category, kind, energy_kwh, power_kw, duration_min,
                     annual_kwh, profile, default_start, shiftable, notes, sources, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    d["id"], d["name"], d["category"], d["kind"], d.get("energy_kwh"),
                    d.get("power_kw"), d["duration_min"], d.get("annual_kwh"),
                    _dumps(d.get("profile")), d.get("default_start"),
                    1 if d.get("shiftable", True) else 0, d.get("notes"),
                    _dumps(d.get("sources", [])), i,
                ),
            )
        conn.execute("DELETE FROM heating_systems")
        for i, h in enumerate(data["heating_systems"]):
            conn.execute(
                """INSERT INTO heating_systems (id, name, cop_curve, min_temp, coverage, notes,
                     sources, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    h["id"], h["name"], _dumps(h["cop_curve"]), h.get("min_temp"),
                    h.get("coverage", 1.0), h.get("notes"), _dumps(h.get("sources", [])), i,
                ),
            )
        conn.execute("DELETE FROM building_eras")
        for i, e in enumerate(data["building_eras"]):
            conn.execute(
                "INSERT INTO building_eras (id, label, kwh_m2_a, sources, sort_order) VALUES (?, ?, ?, ?, ?)",
                (e["id"], e["label"], e["kwh_m2_a"], _dumps(e.get("sources", [])), i),
            )
        conn.execute("DELETE FROM locations")
        for i, loc in enumerate(data["locations"]):
            conn.execute(
                """INSERT INTO locations (id, name, fmi_place, lat, lon, degree_days, sources, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    loc["id"], loc["name"], loc["fmi_place"], loc["lat"], loc["lon"],
                    loc["degree_days"], _dumps(loc.get("sources", [])), i,
                ),
            )
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('reference_data_version', ?) "
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            (data.get("version", ""),),
        )


def ensure_reference_data(conn, path):
    """Lataa viitetiedot vain jos tietokanta on vielä tyhjä."""
    if conn.execute("SELECT COUNT(*) FROM devices").fetchone()[0]:
        return False
    with open(path, encoding="utf-8") as f:
        load_reference_data(conn, json.load(f))
    return True
