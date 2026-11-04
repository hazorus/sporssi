#!/usr/bin/env python3
"""Päivittää laitteiden, lämmitysjärjestelmien, rakennusten ja paikkakuntien viitetiedot
sovelluksen tietokantaan. Tiedot eivät päivity automaattisesti, vaan aja tämä, kun olet
muokannut tiedostoa data/reference_data.json (tai anna toinen JSON-tiedosto).

  SPORSSI_DB=/var/lib/sporssi/sporssi.sqlite3 python3 scripts/update_reference_data.py [polku.json]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from sporssi.cli import main  # noqa: E402

if __name__ == "__main__":
    main(["load-reference", *sys.argv[1:]])
