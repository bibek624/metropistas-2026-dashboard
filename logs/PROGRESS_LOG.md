# Progress Log

## 2026-06-12 — round 5 (user feedback)

- Test-line labels removed from the map; clicking a line opens a MapLibre popup tooltip
  on the line with file name, test date, driven miles and the per-road on-network table
  (bottom panel no longer used for runs). Line clicks take precedence over the polygon
  underneath (queryRenderedFeatures guard).
- Clicked segment/section now gets a cyan highlight outline (own "sel" source, full
  geometry looked up in DATA, not the tile-clipped feature). Cleared when the info panel
  is closed and on level/network switches.
- Legend "Friction number = floor(mean μ × 100)…" note deleted.
- AMPR/PRTR switch no longer zooms; only individual road clicks zoom.
- Right-panel card renamed Layer → View (and MFV legend wording).

## 2026-06-12 — round 4 (user feedback)

- **Colors**: value ramps now red→yellow→green (red = bad, green = good) for Friction 2026
  and Δ Friction; gray "no value" is clearly distinct (the old sand 50-color ≈ gray problem).
- **"All" network view removed** — AMPR / PRTR only (default AMPR); switching networks
  auto-zooms to that network's extent; off-network miles row kept (global figure).
- **Right-hand docked panel** replaces the floating layer box: Layer card (+legend),
  Basemap card, Test lines card with a Show-test-lines toggle that reveals the Days/Runs
  dropdowns. Left sidebar = Progress + Roads only.
- **Test lines**: dashed colored lines over white casing, labeled along the line with
  "date · file name". Labels live on a SEPARATE geojson source so a failed glyph fetch
  can only drop labels — it can no longer take the line layers down with it (suspected
  cause of the invisible-lines bug; map.on("error") logging added so any remaining cause
  shows in the browser console). Line colors are baked per-feature (_color) instead of a
  match expression.
- **Info panel** is a horizontal bottom strip: identity+chips | metadata columns | charts —
  content fits without vertical scrolling.
- **MFV mode** now shows IRI-focused info (IRI 2025 chip, IRI 2026 "—", IRI/PCI charts,
  no friction bars/chips/metadata) instead of repeating RFT values.
- **2021 columns omitted** for PRTR (no 2021 fields in its schema) — charts detect absence.

## 2026-06-12 — polish round 3 (user feedback)

- **Satellite basemap** (Esri World Imagery) is now the default background; a Basemap
  radio (Satellite / Streets light) sits at the bottom of the map layer box.
- **Naming fixed**: Δ layer is "Δ Friction (2026 − 2025)" — the 2025 friction value is the
  Skid_2025 column, labelled Friction everywhere; exported prop renamed d_skid → d_friction.
- **Info panel** moved to the bottom-RIGHT of the map, width = max-content (no full-width
  white space). Added: SecID chip, Friction 2025 chip, Δ Friction chip, and a compact
  2-column metadata grid (Test file, Test date, Friction calculation date, Section date —
  test file/date from pt_filename/pt_testlayer, newly exported by the ETL).
  Rutting chart replaced with **PCI** (2021/2024/2025); Skid chart retitled Friction.
- **Test-line visibility / initial-render fixes**: map 'load' promise registered before the
  data fetches (race could stall init), day-change handler runs applyAll() in a finally,
  tl-* layers are moveLayer()'d to the top on every applyAll, and the latest day's runs are
  preselected on load so lines are visible immediately.
- **Segment borders**: white zoom-interpolated boundary lines per level (segments thin,
  sections thicker) so 0.05-mi segments read individually and the two levels look distinct.
- **Smoother zoom**: geojson sources maxzoom 14 (no tile re-cutting past z14), CARTO @2x
  tiles declared at correct 512 tileSize, fadeDuration 0.
- **Header**: RFT/MFV toggle enlarged + outlined at far left, header gap 22px.

## 2026-06-12 — redesign (user feedback round 2)

**Collected logic corrected** — collected is a network-level metric, not a per-segment one.
- ETL now dissolves each NETWORKID's inventory polygons, buffers 15 m, and intersects every
  test line against every road footprint. A run crossing several roads (PR2→PR22→PR18)
  splits its mileage between them; off-network ramp/connector mileage (41.8 mi so far)
  counts only to day totals. Per-run road breakdown stored in `routes`.
- "Collected vs not" map layer removed (it duplicated sectioned); per-segment `collected`
  prop dropped. Collected % gauge = intersected line-miles / road total. AMPR now 74.1%.
- New numbers: MTSPR22 203.5/260 mi collected; MTSPR53A 94.8/99.9; MTSPR66 22.8/55.8.

**UI redesign (Apple-ish progressive disclosure)**
- RFT/MFV mode toggle moved to the header (primary control); map-layer box on the right is
  now a single-select radio list with the legend underneath it (sidebar decluttered).
- Sidebar = 3 cards: Progress (gauges + miles), Roads (collapsible), Test lines (collapsed
  by default). Road bars back to overlapped single track — larger fill drawn first, smaller
  on top — with "C collected x%" / "S sectioned x%" labels beneath.
- Test lines: Days multi-select + ONE merged Runs multi-select across all selected days,
  "[MM-DD]" prefix when several days are selected. No more per-day dropdown explosion.
- Popups replaced by a bottom info panel over the map (sidebar untouched): chips + mini
  bar charts for IRI (21/24/25/26), Skid/Friction (21/24/25/26), Rutting (21/24/25).
  ETL exports the history columns (schema-adaptive). Test-line clicks show run info +
  per-road mileage there too.
- Palette: gray = no data, blue = sectioned/positive, amber = collected; friction ramp
  orange→sand→blue; Δ layer PuOr. No red/green binaries.
- Visibility/perf: color-matched outline layer with zoom-interpolated width (roads readable
  zoomed out), geojson tolerance 0.6, test lines drawn from a dedicated source via setData
  (fixes invisible test lines) with white casing + day colors.


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
