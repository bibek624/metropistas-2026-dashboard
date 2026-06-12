# Metropistas 2026 — Data Collection Dashboard

Static web dashboard showing daily RFT data-collection and sectioning progress for the
AMPR and PRTR networks in Puerto Rico. See [DATA_STRUCTURE.md](DATA_STRUCTURE.md) for the
source-data layout and [PLAN.md](PLAN.md) for design/metric definitions.

## Quick start (local)

```bat
:: 1. Refresh data from the geodatabases (needs ArcGIS Pro python)
"C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe" scripts\export_dashboard_data.py

:: 2. Serve the site
cd docs
python -m http.server 8456
:: open http://localhost:8456
```

## Pieces

| Path | What it does |
|------|--------------|
| `scripts/export_dashboard_data.py` | ETL: reads `Inventory_2026.gdb` (0.05-mi segments + original sections) and `RFT_Test_Lines_2026.gdb`, writes `docs/data/*.geojson` + `stats.json` |
| `docs/` | The site (MapLibre GL JS, no build step). Host as GitHub Pages root. |
| `run_daily.bat` | ETL + `git commit/push` of `docs/data`. Hook into Task Scheduler for daily updates. |
| `logs/` | ETL run logs, exploration outputs, progress log |

## Dashboard features

- **AMPR / PRTR / All** toggle, road (NETWORKID) dropdown or click a road bar to focus
- **Level toggle**: 0.05-mi segments ↔ original (pre-explode) sections.
  Section friction = area-weighted mean of its segments' 2026 friction (`friction_aw`).
- **Views**: Friction 2026 · Collected vs not · Sectioned vs not · Δ vs Skid 2025 ·
  Δ IRI (placeholder until MFV 2026 sectioning exists)
- **Gauges**: semicircular collected % + sectioned % for current selection; per-road bars
- **Test lines**: per-day checkboxes (overlay any combination), expand a day to toggle
  individual runs (.slf files), labels on the map, click for run details

## Publishing to GitHub Pages

```bash
cd D:/Projects/Metropistas_2026/Data_Collection_Dashboard
git remote add origin https://github.com/<you>/metropistas-2026-dashboard.git
git push -u origin master
# GitHub → repo Settings → Pages → Source: Deploy from branch, branch master, folder /docs
```

Then register the daily task:

```bat
schtasks /Create /TN "Metropistas Dashboard Update" /TR "D:\Projects\Metropistas_2026\Data_Collection_Dashboard\run_daily.bat" /SC DAILY /ST 18:00
```

## Adding a new collection day

Nothing to do — the ETL picks up every `TEST_YYYYMMDD_Line` FC in `RFT_Test_Lines_2026.gdb`
and every segment row automatically. Just keep the existing upstream workflow
(copy raw → remove bridges → section → calc friction → copy test lines) and let
`run_daily.bat` run.

## Known limitations / next steps

- MFV/IRI 2026 view is a placeholder until MFE sectioning produces 2026 IRI columns.
- Test-line miles are attributed to roads by parsing `FILE_NAME` route tokens; connector/
  ramp runs that never mention a toll route (~2 mi so far) count only toward day totals.
- GeoJSON payload ≈ 10 MB; if it grows too heavy, switch to vector tiles (tippecanoe/PMTiles).
