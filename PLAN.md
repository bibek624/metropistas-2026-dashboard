# Data Collection Dashboard — Plan

_Last updated: 2026-06-12_

## Goal
A static, GitHub-Pages-hostable dashboard the field crew can open daily to see:
- Map of the network (AMPR / PRTR toggle, individual road selection)
- Collection progress (test-line miles vs total network miles) — overall + per network ID
- Sectioning progress (segments with friction vs all) — overall + per network ID
- Switchable map views: friction 2026, collected/not, sectioned/not, Δ vs 2025
- Daily test lines, overlay multiple days, per-file selection, labels

## Architecture

```
Data_Collection_Dashboard/
├── scripts/
│   ├── export_dashboard_data.py   ← arcpy ETL: GDB → docs/data/*.geojson + stats.json
│   ├── inventory_gdbs.py          ← one-off: GDB inventory (exploration)
│   └── explore_stats.py           ← one-off: summary stats (exploration)
├── docs/                          ← static site (GitHub Pages root)
│   ├── index.html
│   ├── app.js / style.css
│   └── data/
│       ├── segments_AMPR.geojson  ← 0.05-mi segments (simplified, WGS84)
│       ├── segments_PRTR.geojson
│       ├── sections_AMPR.geojson  ← original sections + area-weighted friction
│       ├── sections_PRTR.geojson
│       ├── testlines.geojson      ← all days merged; props: day, FILE_NAME, length_mi
│       └── stats.json             ← all metrics + generated timestamp
├── run_daily.bat                  ← ETL + git commit/push (Task Scheduler entry point)
├── logs/                          ← run logs, exploration outputs
├── DATA_STRUCTURE.md / PLAN.md / README.md
```

## Metric definitions

- **Total network length** (per NETWORKID): Σ inventory `length` (ft) → miles.
- **Collected length**: Σ test-line lengths, geometry projected to UTM 20N (meters) → miles.
  Attributed to NETWORKID by parsing route tokens (PR22, PR5, PR52, PR53A, PR53B, PR66, PR18, PR20)
  from `FILE_NAME`; unmatched runs (connectors/ramps PR2, PR167…) attributed to the day total only.
- **Sectioned length**: Σ derived segment length over segments where `friction_section IS NOT NULL`,
  with `seg_len_ft = Shape_Area_m² / (area_ft² × 0.092903) × length_ft`.
- **Section-level (merged) friction**: per SecID, Σ(friction × Shape_Area) / Σ(Shape_Area) over
  children with friction → written to the sections GeoJSON (`friction_aw`), plus
  `pct_sectioned` (area % of children with friction) and `collected` (any child has points).

## Map views (segment + section level)
1. **Friction 2026** — graduated colors on `friction_section` (segments) / `friction_aw` (sections)
2. **Collected vs not** — `pt_count > 0` or `section_status` set
3. **Sectioned vs not** — `friction_section` not null
4. **Δ Skid 2025 → Friction 2026 (RFT)** — `friction_section − Skid_2025`
5. **Δ IRI 2025 → IRI 2026 (MFV)** — placeholder until MFE/IRI sectioning exists

## UI
- Header: AMPR / PRTR toggle, road (NETWORKID) dropdown, view switcher, segment/section level toggle
- Left panel: semicircular gauge (overall collected %, sectioned %), per-network-ID mini bars,
  miles summary (total / collected / sectioned), last-updated stamp
- Test lines panel: day checkboxes (overlay multiple), expandable per-file checkbox list, distinct
  colors per day, hover label = FILE_NAME + length
- Map: MapLibre GL JS + free OSM raster basemap; click feature → popup with attributes

## Automation
- `run_daily.bat`: arcgispro-py3 python export → git add/commit/push (repo = this folder,
  GitHub Pages serves /docs). Register with Windows Task Scheduler (daily, e.g. 18:00).

## Status / next steps
- [x] Explore data, verify units, document structure
- [ ] ETL script
- [ ] Front-end
- [ ] Automation + GitHub setup
- [ ] Later: MFV/IRI 2026 layer once MFE sectioning is done; vector tiles if GeoJSON too heavy
