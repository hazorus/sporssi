"""Aikavyöhykeapurit. Suomen vuorokausi on 23, 24 tai 25 tuntia pitkä."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

HEL = ZoneInfo("Europe/Helsinki")
SLOT = 15 * 60  # sekuntia


def local_day_bounds(day: date):
    """Palauttaa (alku, loppu) UTC-epoch-sekunteina paikalliselle vuorokaudelle."""
    start = datetime.combine(day, time(0), HEL)
    end = datetime.combine(day + timedelta(days=1), time(0), HEL)
    return int(start.timestamp()), int(end.timestamp())


def today_local(now=None):
    now = now or datetime.now(timezone.utc)
    return now.astimezone(HEL).date()


def iso_utc(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_local(epoch):
    return datetime.fromtimestamp(epoch, HEL).isoformat()


def parse_iso(text):
    """ISO 8601 -aika (Z tai offset) -> UTC epoch s."""
    text = text.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())
