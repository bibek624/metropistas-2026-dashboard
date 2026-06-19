# -*- coding: utf-8 -*-
"""Bundle the dashboard into ONE self-contained .html that opens by double-click.

No web server, no Python, no CDN required at open time (MapLibre is inlined;
only the background map tiles need internet — everything else works offline).

Output: dist/Metropistas_Dashboard.html
Run with any Python 3 (stdlib only): python scripts/build_standalone.py
"""
import base64
import json
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
DATA = os.path.join(DOCS, "data")
DIST = os.path.join(ROOT, "dist")
MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"
MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"

DATA_FILES = {
    "stats": "stats.json",
    "segments_AMPR": "segments_AMPR.geojson",
    "segments_PRTR": "segments_PRTR.geojson",
    "sections_AMPR": "sections_AMPR.geojson",
    "sections_PRTR": "sections_PRTR.geojson",
    "testlines": "testlines.geojson",
    "testlines_MFV": "testlines_MFV.geojson",
}


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8")


def main():
    os.makedirs(DIST, exist_ok=True)

    # 1. raw data → one JS object literal, parsed once into window.__DATA__
    print("bundling data ...")
    blobs = {}
    for key, fname in DATA_FILES.items():
        blobs[key] = read(os.path.join(DATA, fname))
    data_js = "window.__DATA__ = {\n" + ",\n".join(
        '  "{}": {}'.format(k, v) for k, v in blobs.items()) + "\n};"

    # 2. app.js with fetch() rewired to the inlined data
    app = read(os.path.join(DOCS, "app.js"))
    app = app.replace(
        'async function loadJSON(url) {\n'
        '  const r = await fetch(url + "?v=" + Date.now());\n'
        '  if (!r.ok) throw new Error(url + " → " + r.status);\n'
        '  return r.json();\n'
        '}',
        'async function loadJSON(url) {\n'
        '  const key = url.replace("data/", "").replace(/\\.(json|geojson)$/, "");\n'
        '  if (window.__DATA__ && key in window.__DATA__) return window.__DATA__[key];\n'
        '  throw new Error("missing embedded data: " + key);\n'
        '}')
    if "window.__DATA__ && key in" not in app:
        raise SystemExit("ERROR: loadJSON not rewired — app.js shape changed")

    # 3. logo → data URI
    logo_b64 = base64.b64encode(
        open(os.path.join(DOCS, "ara-logo.png"), "rb").read()).decode()
    logo_uri = "data:image/png;base64," + logo_b64

    # 4. inline CSS + MapLibre (lib fetched at build time, embedded in output)
    css = read(os.path.join(DOCS, "style.css"))
    print("fetching MapLibre to inline ...")
    ml_js = fetch(MAPLIBRE_JS)
    ml_css = fetch(MAPLIBRE_CSS)

    # 5. assemble index.html, stripping external <link>/<script>/img src
    html = read(os.path.join(DOCS, "index.html"))
    html = re.sub(r'<link[^>]*maplibre-gl[^>]*>', '', html)
    html = re.sub(r'<link[^>]*href="style\.css"[^>]*>', '', html)
    html = re.sub(r'<script[^>]*maplibre-gl[^>]*></script>', '', html)
    html = re.sub(r'<script[^>]*src="app\.js"[^>]*></script>', '', html)
    html = html.replace('src="ara-logo.png"', 'src="{}"'.format(logo_uri))

    bundle = (
        "<style>\n" + ml_css + "\n" + css + "\n</style>\n"
        "<script>\n" + ml_js + "\n</script>\n"
        "<script>\n" + data_js + "\n</script>\n"
        "<script>\n" + app + "\n</script>\n"
    )
    # inject before </body>
    out_html = html.replace("</body>", bundle + "</body>")

    out_path = os.path.join(DIST, "Metropistas_Dashboard.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(out_html)
    mb = os.path.getsize(out_path) / 1e6
    print("wrote {} ({:.1f} MB)".format(out_path, mb))
    print("Double-click to open — no server needed.")


if __name__ == "__main__":
    main()
