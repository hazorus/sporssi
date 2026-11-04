"""WSGI-sisääntulo: gunicorn wsgi:app  tai  mod_wsgi (WSGIScriptAlias /sporssi/api .../wsgi.py)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sporssi import create_app  # noqa: E402

flask_app = create_app()


def app(environ, start_response):
    # mod_wsgi: jos sovellus on liitetty polkuun .../api, siirretään /api takaisin PATH_INFOon,
    # jotta Flaskin /api/-reitit toimivat samoin kuin gunicornin takana.
    script = environ.get("SCRIPT_NAME", "")
    if script.endswith("/api"):
        environ["SCRIPT_NAME"] = script[:-4]
        environ["PATH_INFO"] = "/api" + environ.get("PATH_INFO", "")
    return flask_app(environ, start_response)
