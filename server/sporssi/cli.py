"""Komentorivityökalut (ajetaan cronista tai käsin).

  python -m sporssi.cli update            # tämän päivän ja huomisen hinnat + säät
  python -m sporssi.cli backfill --days 400
  python -m sporssi.cli backfill --since 2020-01-01
  python -m sporssi.cli load-reference [data/reference_data.json]
  python -m sporssi.cli stats
"""

import argparse
import json
import sys
import time
from datetime import date, timedelta

from . import db, heating, prices
from .config import Config
from .timeutil import SLOT, local_day_bounds, today_local


def cmd_update(cfg, conn, args):
    today = today_local()
    start, _ = local_day_bounds(today - timedelta(days=1))
    _, end = local_day_bounds(today + timedelta(days=1))
    n = prices.fetch_range(conn, cfg, start, end)
    print(f"Hinnat: {n} riviä ({cfg.price_source})")
    db.prune_fetch_log(conn)
    places = args.locations.split(",") if args.locations else ["helsinki"]
    for loc_id in places:
        try:
            heating.refresh_weather(conn, heating.get_location(conn, loc_id))
            print(f"Sää päivitetty: {loc_id}")
        except Exception as exc:
            print(f"Sää epäonnistui ({loc_id}): {exc}", file=sys.stderr)


def _chunk_complete(conn, area, first, last):
    start, _ = local_day_bounds(first)
    _, end = local_day_bounds(last)
    return len(prices.slot_prices(conn, area, start, end)) == (end - start) // SLOT


def cmd_backfill(cfg, conn, args):
    """Hakee historiaa jaksoittain. Jo täydet jaksot ohitetaan (paitsi --force), ja epäonnistunut
    jakso yritetään uudelleen; pysyvästi epäonnistuneet listataan lopuksi, eikä haku keskeydy."""
    today = today_local()
    if args.since:
        day = date.fromisoformat(args.since)
    else:
        day = today - timedelta(days=args.days)
    total, skipped, failed = 0, 0, []
    while day <= today + timedelta(days=1):
        chunk_end = min(day + timedelta(days=args.chunk), today + timedelta(days=2))
        label = f"{day} – {chunk_end - timedelta(days=1)}"
        if not args.force and _chunk_complete(conn, cfg.area, day, chunk_end - timedelta(days=1)):
            skipped += 1
            day = chunk_end
            continue
        start, _ = local_day_bounds(day)
        end, _ = local_day_bounds(chunk_end)
        for attempt in range(1, args.retries + 2):
            try:
                n = prices.fetch_range(conn, cfg, start, end)
                total += n
                print(f"{label}: {n} riviä", flush=True)
                break
            except Exception as exc:
                print(f"{label}: virhe ({exc})", file=sys.stderr, flush=True)
                if attempt > args.retries:
                    failed.append(label)
                else:
                    time.sleep(args.pause * 5 * attempt)
        time.sleep(args.pause)
        day = chunk_end
    print(f"Yhteensä {total} riviä, {skipped} valmista jaksoa ohitettu.")
    if failed:
        print("Epäonnistuneet jaksot (aja komento uudelleen, valmiit ohitetaan):", ", ".join(failed))
        sys.exit(1)


def cmd_load_reference(cfg, conn, args):
    path = args.path or cfg.reference_data
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    db.load_reference_data(conn, data)
    print(f"Viitetiedot ladattu ({path}): {len(data['devices'])} laitetta, "
          f"{len(data['heating_systems'])} lämmitysjärjestelmää, "
          f"{len(data['building_eras'])} rakennusikäluokkaa, {len(data['locations'])} paikkakuntaa")


def cmd_stats(cfg, conn, args):
    print(json.dumps(prices.stats(conn, cfg.area, args.days), indent=2, ensure_ascii=False))


def main(argv=None):
    p = argparse.ArgumentParser(prog="sporssi")
    sub = p.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("update", help="hae eilisen, tämän päivän ja huomisen hinnat sekä säät")
    u.add_argument("--locations", help="paikkakunnat pilkulla eroteltuna (oletus helsinki)")
    b = sub.add_parser("backfill", help="hae historiaa taaksepäin")
    b.add_argument("--days", type=int, default=400)
    b.add_argument("--since", help="alkupäivä VVVV-KK-PP (korvaa --days)")
    b.add_argument("--chunk", type=int, default=31, help="päivää per pyyntö")
    b.add_argument("--force", action="store_true", help="hae myös jo täydet jaksot uudelleen")
    b.add_argument("--retries", type=int, default=2, help="uudelleenyritykset per jakso")
    b.add_argument("--pause", type=float, default=1.0, help="tauko pyyntöjen välillä (s)")
    r = sub.add_parser("load-reference", help="lataa laite- ja lämmitystiedot tietokantaan")
    r.add_argument("path", nargs="?")
    s = sub.add_parser("stats", help="näytä vuoden keskihinta ja hajonta")
    s.add_argument("--days", type=int, default=365)
    args = p.parse_args(argv)

    cfg = Config()
    conn = db.connect(cfg.db_path)
    db.init_db(conn)
    if args.cmd != "load-reference":
        db.ensure_reference_data(conn, cfg.reference_data)
    {"update": cmd_update, "backfill": cmd_backfill,
     "load-reference": cmd_load_reference, "stats": cmd_stats}[args.cmd](cfg, conn, args)


if __name__ == "__main__":
    main()
