"""WSGI-sisääntulo: gunicorn wsgi:app  tai  mod_wsgi (WSGIScriptAlias /sporssi/api .../wsgi.py).

Asetukset luetaan ympäristömuuttujista sekä tiedostoista /etc/sporssi.env ja <repo>/sporssi.env
(muoto AVAIN=arvo). mod_wsgi ei välitä Apachen SetEnv-arvoja os.environiin, joten mod_wsgi-
asennuksessa asetukset kannattaa antaa jommassakummassa tiedostossa.

Jos sovellus ei käynnisty (esim. tietokantahakemistoon ei voi kirjoittaa), jokainen pyyntö saa
JSON-vastauksen, jossa on virheen syy. Näin vian näkee selaimesta ilman Apachen lokeja.
"""

import json
import os
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

ENV_FILES = [Path("/etc/sporssi.env"), HERE.parent / "sporssi.env"]


def load_env_files():
    for path in ENV_FILES:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key.startswith("export "):
                key = key[7:].strip()
            os.environ.setdefault(key, value.strip().strip("'\""))


load_env_files()

try:
    from sporssi import create_app

    flask_app = create_app()
    startup_error = None
except Exception as exc:  # käynnistysvirhe näytetään vastauksessa
    traceback.print_exc()
    flask_app = None
    startup_error = {
        "error": "Sporssi-rajapinta ei käynnistynyt",
        "type": type(exc).__name__,
        "message": str(exc),
        "hint": "Tarkempi virhe Apachen virhelokissa.",
    }


def app(environ, start_response):
    if startup_error is not None:
        body = json.dumps(startup_error, ensure_ascii=False, indent=1).encode("utf-8")
        start_response("500 Internal Server Error", [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
        ])
        return [body]
    # mod_wsgi: jos sovellus on liitetty polkuun .../api, siirretään /api takaisin PATH_INFOon,
    # jotta Flaskin /api/-reitit toimivat samoin kuin gunicornin takana.
    script = environ.get("SCRIPT_NAME", "")
    if script.endswith("/api"):
        environ["SCRIPT_NAME"] = script[:-4]
        environ["PATH_INFO"] = "/api" + environ.get("PATH_INFO", "")
    return flask_app(environ, start_response)


application = app  # mod_wsgi:n oletusnimi
