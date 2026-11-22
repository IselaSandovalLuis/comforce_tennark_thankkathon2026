"""Optional single-query lookup of reviewer-supplied public Milwaukee places."""

import json
import os
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from backend.comforce_db import write_transaction
from backend.map_data import public_point

DEFAULT_URL = "https://nominatim.openstreetmap.org/search"


def lookup_public_place(db, query):
    query = " ".join(query.split())
    if not 4 <= len(query) <= 150 or "@" in query:
        raise ValueError("Enter a public Milwaukee landmark, intersection, or address.")
    contact = os.environ.get("MILWAUKEE_GEOCODER_CONTACT", "").strip()
    if not contact:
        raise ValueError("Set MILWAUKEE_GEOCODER_CONTACT before using online lookup.")
    url = os.environ.get("MILWAUKEE_GEOCODER_URL", DEFAULT_URL)
    key = f"{url} {query.casefold()}"
    now = time.time()
    with write_transaction(db):
        db.execute("""CREATE TABLE IF NOT EXISTS public_geocode_cache (
                      query TEXT PRIMARY KEY, result TEXT NOT NULL, saved_at REAL NOT NULL)""")
        db.execute("""CREATE TABLE IF NOT EXISTS public_geocode_rate (
                      id INTEGER PRIMARY KEY CHECK (id = 1), last_request REAL NOT NULL)""")
        cached = db.execute("SELECT result FROM public_geocode_cache WHERE query = ? AND saved_at > ?",
                            (key, now - 86400 * 7)).fetchone()
        if cached:
            return json.loads(cached["result"])
        last = db.execute("SELECT last_request FROM public_geocode_rate WHERE id = 1").fetchone()
        if last and now - last[0] < 1.1:
            raise ValueError("Wait a moment before requesting another public lookup.")
        db.execute("INSERT OR REPLACE INTO public_geocode_rate VALUES (1, ?)", (now,))

    params = urlencode({"q": query + ", Milwaukee, Wisconsin", "format": "jsonv2",
                        "countrycodes": "us", "viewbox": "-88.10,43.21,-87.85,42.90",
                        "bounded": "1", "limit": 4})
    request = Request(url + "?" + params, headers={"User-Agent": f"MilwaukeeTogetherHeatmap/1.0 ({contact})"})
    try:
        with urlopen(request, timeout=6) as response:
            matches = json.loads(response.read(100_000))
        if not isinstance(matches, list):
            raise ValueError("Unexpected lookup response.")
        result = []
        for match in matches:
            latitude, longitude = public_point(float(match["lat"]), float(match["lon"]))
            if latitude is not None:
                result.append({"label": match["display_name"], "latitude": latitude, "longitude": longitude})
    except (URLError, TimeoutError, ValueError, KeyError, TypeError) as error:
        raise ValueError("Public location lookup is unavailable. Use a named area or reviewed coordinates.") from error
    db.execute("""INSERT INTO public_geocode_cache VALUES (?, ?, ?)
                  ON CONFLICT (query) DO UPDATE SET result = excluded.result, saved_at = excluded.saved_at""",
               (key, json.dumps(result), now))
    return result
