"""Asetukset ympäristömuuttujista.

SPORSSI_DB             SQLite-tiedoston polku (oletus: <repo>/var/sporssi.sqlite3)
SPORSSI_PRICE_SOURCE   auto | entsoe | sahkotin  (auto = entsoe jos token on annettu)
ENTSOE_TOKEN           ENTSO-E Transparency Platformin Web API -token
SPORSSI_AREA           tarjousalue, oletus FI
SPORSSI_LAZY_FETCH     1 = API hakee puuttuvat hinnat/säät pyynnön yhteydessä (oletus 1)
SPORSSI_CORS_ORIGIN    sallittu origin, jos käyttöliittymä on eri osoitteessa (oletus: ei CORSia)
"""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class Config:
    def __init__(self, **overrides):
        env = os.environ
        self.db_path = overrides.get(
            "db_path", env.get("SPORSSI_DB", str(REPO_ROOT / "var" / "sporssi.sqlite3"))
        )
        self.entsoe_token = overrides.get("entsoe_token", env.get("ENTSOE_TOKEN", "").strip())
        source = overrides.get("price_source", env.get("SPORSSI_PRICE_SOURCE", "auto")).strip()
        if source == "auto":
            source = "entsoe" if self.entsoe_token else "sahkotin"
        self.price_source = source
        self.area = overrides.get("area", env.get("SPORSSI_AREA", "FI"))
        self.lazy_fetch = overrides.get("lazy_fetch", env.get("SPORSSI_LAZY_FETCH", "1") == "1")
        self.cors_origin = overrides.get("cors_origin", env.get("SPORSSI_CORS_ORIGIN", ""))
        self.reference_data = overrides.get(
            "reference_data", str(REPO_ROOT / "data" / "reference_data.json")
        )
        self.timezone = "Europe/Helsinki"
