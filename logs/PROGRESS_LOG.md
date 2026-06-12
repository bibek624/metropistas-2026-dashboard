# Progress Log

## 2026-06-12 — UI revision (user feedback round 1)

- **RFT / MFV mode toggle** + single-select layer dropdown moved into a floating
  "Map layer" box on the right side of the map. MFV layers (IRI 2026, collected, Δ IRI)
  are listed but render as placeholders until MFE sectioning produces 2026 IRI values.
- **Removed "All roads" header dropdown** — the By-road panel is now the road selector:
  hover highlight, 🔍 icon, hint text; click zooms to the road, click again clears
  (flies back to overview).
- **Road bars fixed**: collected (orange) and sectioned (green) now drawn on separate
  tracks with % labels instead of overlapping fills (the overlap made orange look wrong).
- **Test lines** switched from a long checkbox list to multi-select dropdowns:
  a Days dropdown (with "All days"), then one Runs dropdown per selected day
  (with "All runs" + individual .slf runs). Scales to ~30 runs/day.


## 2026-06-12 — initial build

**Explored & documented** (see DATA_STRUCTURE.md)
- Mapped root folder; identified the 6 GDBs and their roles. "No-breeze" = `RFT_Data_2026_No_Bridge.gdb` (bridge points removed).
- Inventoried every feature class (counts, geometry, fields) → `logs/gdb_inventory.json`.
- Verified units: inventory `length` = feet, `area` = sq ft (12-ft lanes; ft²×0.09290304 == Shape_Area m²).
- Networks: AMPR = MTSPR22 + MTSPR5 (274.6 mi); PRTR = MTSPR18/20/52/53A/53B/66 (589.7 mi).
- Snapshot: 363 test-line miles collected (Jun 3–9); friction done for 2,375 MTSPR22 +
  1,755 MTSPR53A + 403 MTSPR66 segments; MFV/IRI 2026 not started.

**Built**
- `scripts/export_dashboard_data.py` — ETL (12.6 s run): segments + sections GeoJSON
  (WGS84, generalized 1 m, 6-dp coords), test lines (per-run features, lengths in UTM 20N),
  `stats.json`. Handles AMPR/PRTR schema difference (PRTR has no SECTIONID → SecCode).
  Derived segment length = Shape_Area / (area×0.09290304) × length (area-fraction × parent length).
  Section-level area-weighted friction (`friction_aw`) + `pct_sectioned` + `collected`.
- `docs/` front-end — MapLibre GL JS, CARTO light basemap. Network/road/level/view controls,
  semicircular gauges, per-road progress bars, day+run test-line toggles with labels, popups,
  legends. No build step.
- `run_daily.bat` — ETL + git commit/push of docs/data; Task Scheduler one-liner in README.

**Verification**
- ETL ran clean end-to-end; stats cross-checked against exploration numbers.
- app.js compiles (node vm via VS Code's runtime); all assets serve 200 locally.
- Headless-browser screenshot blocked by enterprise policy → visual check must be manual:
  http://localhost:8456 (server left running).

**Decisions**
- Collected % gauge uses segment-miles touched by sectioning (comparable to network total);
  raw test-line miles shown separately (includes repeat runs, both shown in miles table).
- Δ view = friction_2026 − Skid_2025 (positive = better). IRI Δ awaits MFV sectioning.

**Next**
- [ ] User visual check of the dashboard; tweak styling/UX as requested.
- [ ] git remote + GitHub Pages + scheduled task (needs user's GitHub repo).
- [ ] MFV/IRI 2026 layer once MFE sectioning produces values.
