/* Metropistas 2026 — Data Collection Dashboard */
"use strict";

const GROUPS = ["AMPR", "PRTR"];
const DAY_COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#008080", "#9a6324", "#800000", "#000075"];

const state = {
  net: "ALL",            // ALL | AMPR | PRTR
  road: "",              // "" = all roads
  level: "segments",     // segments | sections
  view: "friction",
  selectedRuns: new Set(), // "day|file" keys; empty per day-checkbox handled below
  dayOn: new Set(),
};

let stats = null;
let map = null;
const DATA = {}; // level -> merged FeatureCollection

const $ = (sel) => document.querySelector(sel);

/* ---------- data loading ---------- */
async function loadJSON(url) {
  const r = await fetch(url + "?v=" + Date.now());
  if (!r.ok) throw new Error(url + " → " + r.status);
  return r.json();
}

async function init() {
  stats = await loadJSON("data/stats.json");
  $("#updated").textContent = "Updated " + stats.generated;

  map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors © CARTO",
        },
      },
      layers: [{ id: "basemap", type: "raster", source: "osm" }],
    },
    center: [-66.3, 18.35],
    zoom: 9,
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }));

  const [segA, segP, secA, secP, lines] = await Promise.all([
    loadJSON("data/segments_AMPR.geojson"),
    loadJSON("data/segments_PRTR.geojson"),
    loadJSON("data/sections_AMPR.geojson"),
    loadJSON("data/sections_PRTR.geojson"),
    loadJSON("data/testlines.geojson"),
  ]);

  await new Promise((res) => (map.loaded() ? res() : map.on("load", res)));

  DATA.segments = mergeFC(segA, segP);
  DATA.sections = mergeFC(secA, secP);
  map.addSource("segments", { type: "geojson", data: DATA.segments });
  map.addSource("sections", { type: "geojson", data: DATA.sections });
  map.addSource("testlines", { type: "geojson", data: lines });

  for (const lvl of ["segments", "sections"]) {
    map.addLayer({
      id: lvl + "-fill", type: "fill", source: lvl,
      paint: { "fill-color": "#888", "fill-opacity": 0.85 },
      layout: { visibility: lvl === state.level ? "visible" : "none" },
    });
    map.addLayer({
      id: lvl + "-line", type: "line", source: lvl,
      paint: { "line-color": "#ffffff", "line-width": 0.3, "line-opacity": 0.4 },
      layout: { visibility: lvl === state.level ? "visible" : "none" },
    });
    map.on("click", lvl + "-fill", onFeatureClick);
    map.on("mouseenter", lvl + "-fill", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", lvl + "-fill", () => (map.getCanvas().style.cursor = ""));
  }

  map.addLayer({
    id: "testlines-line", type: "line", source: "testlines",
    paint: { "line-width": 3, "line-color": dayColorExpr(), "line-opacity": 0.95 },
    filter: ["in", ["concat", ["get", "day"], "|", ["get", "file"]], ["literal", []]],
  });
  map.addLayer({
    id: "testlines-label", type: "symbol", source: "testlines",
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "file"],
      "text-size": 10,
      "text-font": ["Noto Sans Regular"],
    },
    paint: { "text-color": "#222", "text-halo-color": "#fff", "text-halo-width": 1.2 },
    filter: ["in", ["concat", ["get", "day"], "|", ["get", "file"]], ["literal", []]],
  });
  map.on("click", "testlines-line", onLineClick);

  buildRoadSelect();
  buildTestlinePanel();
  applyAll();
  $("#loading").style.display = "none";
}

function mergeFC(a, b) {
  return { type: "FeatureCollection", features: a.features.concat(b.features) };
}

/* ---------- paint expressions per view ---------- */
const FRICTION_RAMP = [
  0, "#d73027", 30, "#fc8d59", 40, "#fee08b", 50, "#d9ef8b", 60, "#91cf60", 75, "#1a9850",
];

function frictionColor(field) {
  const ramp = ["interpolate", ["linear"], ["to-number", ["get", field]]];
  for (let i = 0; i < FRICTION_RAMP.length; i += 2) ramp.push(FRICTION_RAMP[i], FRICTION_RAMP[i + 1]);
  return ["case", ["==", ["get", field], null], "#c8cdd3", ramp];
}

function diffColor(field) {
  return ["case", ["==", ["get", field], null], "#c8cdd3",
    ["interpolate", ["linear"], ["to-number", ["get", field]],
      -25, "#b2182b", -10, "#ef8a62", -3, "#fddbc7", 0, "#f7f7f7",
      3, "#d1e5f0", 10, "#67a9cf", 25, "#2166ac"]];
}

function paintFor(view, level) {
  const fricField = level === "segments" ? "friction" : "friction_aw";
  switch (view) {
    case "friction":
      return frictionColor(fricField);
    case "collected":
      return ["case", ["==", ["get", "collected"], 1], "#27ae60", "#d64541"];
    case "sectioned":
      if (level === "sections")
        return ["case", ["==", ["get", "friction_aw"], null], "#d64541",
          ["interpolate", ["linear"], ["get", "pct_sectioned"],
            0, "#d64541", 50, "#f5b041", 100, "#27ae60"]];
      return ["case", ["!=", ["get", "friction"], null], "#27ae60", "#d64541"];
    case "d_skid":
      return diffColor("d_skid");
    case "d_iri":
      return "#c8cdd3"; // placeholder until MFV/IRI 2026 exists
    default:
      return "#888";
  }
}

function dayColorExpr() {
  const expr = ["match", ["get", "day"]];
  stats.days.forEach((d, i) => expr.push(d.day, DAY_COLORS[i % DAY_COLORS.length]));
  expr.push("#555");
  return expr;
}

/* ---------- legends ---------- */
function legendFor(view) {
  const rows = [];
  const add = (c, t) => rows.push(`<div class="legend-row"><span class="legend-swatch" style="background:${c}"></span>${t}</div>`);
  if (view === "friction") {
    add("#d73027", "≤ 30"); add("#fc8d59", "30–40"); add("#fee08b", "40–50");
    add("#d9ef8b", "50–60"); add("#91cf60", "60–75"); add("#1a9850", "≥ 75");
    add("#c8cdd3", "No value yet");
    rows.push(`<div class="legend-note">Friction number = floor(mean μ × 100), 2026 RFT</div>`);
  } else if (view === "collected") {
    add("#27ae60", "Collected (has RFT points)"); add("#d64541", "Not collected");
  } else if (view === "sectioned") {
    add("#27ae60", "Sectioned (friction calculated)"); add("#d64541", "Not sectioned");
    if (state.level === "sections") rows.push(`<div class="legend-note">Sections shaded by % of segment area sectioned</div>`);
  } else if (view === "d_skid") {
    add("#b2182b", "≤ −25 (worse)"); add("#ef8a62", "−10"); add("#f7f7f7", "0");
    add("#67a9cf", "+10"); add("#2166ac", "≥ +25 (better)"); add("#c8cdd3", "No 2026 value");
    rows.push(`<div class="legend-note">Friction 2026 − Skid 2025</div>`);
  } else if (view === "d_iri") {
    rows.push(`<div class="legend-note">MFV/IRI 2026 sectioning not done yet — layer will activate once IRI values exist.</div>`);
  }
  $("#legend").innerHTML = rows.join("");
}

/* ---------- filters / state application ---------- */
function featureFilter() {
  const f = ["all"];
  if (state.net !== "ALL") {
    const roads = Object.keys(stats.networks[state.net].by_road);
    f.push(["in", ["get", "NETWORKID"], ["literal", roads]]);
  }
  if (state.road) f.push(["==", ["get", "NETWORKID"], state.road]);
  return f;
}

function applyAll() {
  for (const lvl of ["segments", "sections"]) {
    const vis = lvl === state.level ? "visible" : "none";
    map.setLayoutProperty(lvl + "-fill", "visibility", vis);
    map.setLayoutProperty(lvl + "-line", "visibility", vis);
    map.setFilter(lvl + "-fill", featureFilter());
    map.setFilter(lvl + "-line", featureFilter());
  }
  map.setPaintProperty(state.level + "-fill", "fill-color", paintFor(state.view, state.level));
  const runKeys = [...state.selectedRuns];
  const runFilter = ["in", ["concat", ["get", "day"], "|", ["get", "file"]], ["literal", runKeys]];
  map.setFilter("testlines-line", runFilter);
  map.setFilter("testlines-label", runFilter);
  legendFor(state.view);
  renderStats();
}

/* ---------- sidebar: gauges + tables ---------- */
function netTotals() {
  // returns {total, collected_line, collected_seg, sectioned} for current net selection (or road)
  let roads;
  if (state.road) {
    for (const g of GROUPS) {
      if (stats.networks[g].by_road[state.road]) roads = [[g, state.road]];
    }
  } else if (state.net === "ALL") {
    roads = GROUPS.flatMap((g) => Object.keys(stats.networks[g].by_road).map((r) => [g, r]));
  } else {
    roads = Object.keys(stats.networks[state.net].by_road).map((r) => [state.net, r]);
  }
  const t = { total: 0, line: 0, seg: 0, sect: 0 };
  for (const [g, r] of roads) {
    const v = stats.networks[g].by_road[r];
    t.total += v.total_mi; t.line += v.collected_line_mi;
    t.seg += v.collected_seg_mi; t.sect += v.sectioned_mi;
  }
  return t;
}

function gauge(svgId, pct, color) {
  const svg = $(svgId);
  const clamped = Math.max(0, Math.min(100, pct));
  const a = Math.PI * (1 - clamped / 100);
  const r = 80, cx = 100, cy = 100;
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  const large = clamped > 50 ? 1 : 0;
  svg.innerHTML = `
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" stroke="#e2e8ef" stroke-width="16" fill="none" stroke-linecap="round"/>
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 ${large} 1 ${x} ${y}" stroke="${color}" stroke-width="16" fill="none" stroke-linecap="round"/>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="28" font-weight="700" fill="#2c3e50">${pct.toFixed(1)}%</text>`;
}

function renderStats() {
  const t = netTotals();
  const pctColl = t.total ? (100 * Math.min(t.seg, t.total)) / t.total : 0;
  const pctSect = t.total ? (100 * t.sect) / t.total : 0;
  $("#gauge-title").textContent =
    (state.road || (state.net === "ALL" ? "All networks" : state.net)) + " progress";
  gauge("#gauge-collected", pctColl, "#f5b041");
  gauge("#gauge-sectioned", pctSect, "#27ae60");
  $("#miles-table").innerHTML = `
    <tr><td>Total network</td><td>${t.total.toFixed(1)} mi</td></tr>
    <tr><td>Collected (test-line miles)</td><td>${t.line.toFixed(1)} mi</td></tr>
    <tr><td>Collected (segment miles)</td><td>${t.seg.toFixed(1)} mi</td></tr>
    <tr><td>Sectioned (friction 2026)</td><td>${t.sect.toFixed(1)} mi</td></tr>`;
  renderRoadBars();
}

function renderRoadBars() {
  const box = $("#road-bars");
  const groups = state.net === "ALL" ? GROUPS : [state.net];
  let html = "";
  for (const g of groups) {
    for (const [r, v] of Object.entries(stats.networks[g].by_road)) {
      const pc = v.total_mi ? Math.min(100, (100 * v.collected_seg_mi) / v.total_mi) : 0;
      const ps = v.total_mi ? Math.min(100, (100 * v.sectioned_mi) / v.total_mi) : 0;
      html += `
      <div class="road-bar ${state.road === r ? "selected" : ""}" data-road="${r}">
        <div class="rb-head"><span class="rb-name">${r} <small>(${g})</small></span>
          <span>${v.sectioned_mi.toFixed(0)} / ${v.total_mi.toFixed(0)} mi</span></div>
        <div class="rb-track"><div class="rb-coll" style="width:${pc}%"></div>
          <div class="rb-sect" style="width:${ps}%"></div></div>
      </div>`;
    }
  }
  html += `<div class="legend-note">▮ green = sectioned, ▮ orange = collected. Click a bar to focus that road.</div>`;
  box.innerHTML = html;
  box.querySelectorAll(".road-bar").forEach((el) =>
    el.addEventListener("click", () => {
      state.road = state.road === el.dataset.road ? "" : el.dataset.road;
      $("#road-select").value = state.road;
      applyAll();
      if (state.road) zoomToRoad(state.road);
    }));
}

function zoomToRoad(road) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90, found = false;
  for (const f of DATA[state.level].features) {
    if (f.properties.NETWORKID !== road || !f.geometry) continue;
    found = true;
    walkCoords(f.geometry.coordinates, (x, y) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
  }
  if (found) map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60 });
}

function walkCoords(c, cb) {
  if (typeof c[0] === "number") cb(c[0], c[1]);
  else c.forEach((cc) => walkCoords(cc, cb));
}

/* ---------- test line panel ---------- */
function buildTestlinePanel() {
  const box = $("#testline-days");
  let html = "";
  stats.days.forEach((d, i) => {
    const color = DAY_COLORS[i % DAY_COLORS.length];
    html += `
    <div class="day-row" data-day="${d.day}">
      <label>
        <input type="checkbox" class="day-check" value="${d.day}">
        <span class="day-swatch" style="background:${color}"></span>
        <strong>${d.day}</strong>
        <span class="day-meta">${d.total_mi.toFixed(1)} mi · ${d.n_files} runs</span>
        <button class="day-expand" title="show runs">▾</button>
      </label>
      <div class="file-list">` +
      d.files.map((f) => `
        <label><input type="checkbox" class="file-check" data-day="${d.day}" value="${f.file}" checked>
          <span>${f.file}</span><span class="fl-mi">${f.length_mi} mi</span></label>`).join("") +
      `</div>
    </div>`;
  });
  box.innerHTML = html;

  box.querySelectorAll(".day-expand").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      btn.closest(".day-row").querySelector(".file-list").classList.toggle("open");
    }));

  const sync = () => {
    state.selectedRuns.clear();
    box.querySelectorAll(".day-row").forEach((row) => {
      const day = row.dataset.day;
      if (!row.querySelector(".day-check").checked) return;
      row.querySelectorAll(".file-check").forEach((fc) => {
        if (fc.checked) state.selectedRuns.add(day + "|" + fc.value);
      });
    });
    applyAll();
  };
  box.querySelectorAll(".day-check, .file-check").forEach((cb) =>
    cb.addEventListener("change", sync));
}

/* ---------- popups ---------- */
function popupHTML(p, level) {
  const rows = [];
  const add = (k, v) => { if (v !== null && v !== undefined && v !== "") rows.push(`<tr><td>${k}</td><td>${v}</td></tr>`); };
  add("Road", p.NETWORKID);
  add("Section", p.SECTIONID || p.SecCode);
  add("SecID", p.SecID);
  add("PID", p.PID);
  if (level === "segments") {
    add("Segment", p.segment_id);
    add("Status", p.section_status || "—");
    add("Friction 2026", p.friction ?? "—");
    add("Friction date", p.friction_date);
    add("Points", p.pt_count);
    add("Length", p.seg_len_mi != null ? p.seg_len_mi.toFixed(3) + " mi" : null);
  } else {
    add("Friction 2026 (area-wt)", p.friction_aw ?? "—");
    add("% sectioned", p.pct_sectioned + "%");
    add("Segments (w/ friction)", `${p.n_friction} / ${p.n_segments}`);
    add("Length", p.length_mi + " mi");
  }
  add("Skid 2025", p.Skid_2025);
  add("Δ vs Skid 2025", p.d_skid);
  add("IRI 2025", p.IRI_2025);
  add("Pavement", p.PavementTy);
  return "<table>" + rows.join("") + "</table>";
}

function onFeatureClick(e) {
  const f = e.features[0];
  new maplibregl.Popup().setLngLat(e.lngLat)
    .setHTML(popupHTML(f.properties, state.level)).addTo(map);
}

function onLineClick(e) {
  const p = e.features[0].properties;
  new maplibregl.Popup().setLngLat(e.lngLat)
    .setHTML(`<table><tr><td>Run</td><td>${p.file}</td></tr>
      <tr><td>Day</td><td>${p.day}</td></tr>
      <tr><td>Length</td><td>${p.length_mi} mi</td></tr>
      <tr><td>Route</td><td>${p.route || "connector/ramp"}</td></tr></table>`)
    .addTo(map);
  e.preventDefault && e.preventDefault();
}

/* ---------- header controls ---------- */
function buildRoadSelect() {
  const sel = $("#road-select");
  const groups = state.net === "ALL" ? GROUPS : [state.net];
  const cur = state.road;
  sel.innerHTML = '<option value="">All roads</option>';
  for (const g of groups)
    for (const r of Object.keys(stats.networks[g].by_road))
      sel.innerHTML += `<option value="${r}">${r} (${g})</option>`;
  sel.value = cur && [...sel.options].some((o) => o.value === cur) ? cur : "";
  state.road = sel.value;
}

$("#network-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#network-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.net = e.target.dataset.net;
  buildRoadSelect();
  applyAll();
});

$("#level-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#level-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.level = e.target.dataset.level;
  applyAll();
});

$("#road-select").addEventListener("change", (e) => {
  state.road = e.target.value;
  applyAll();
  if (state.road) zoomToRoad(state.road);
});

$("#view-select").addEventListener("change", (e) => {
  state.view = e.target.value;
  applyAll();
});

init().catch((err) => {
  $("#loading").textContent = "Failed to load: " + err.message;
  console.error(err);
});
