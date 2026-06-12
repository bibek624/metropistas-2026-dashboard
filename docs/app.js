/* Metropistas 2026 — Data Collection Dashboard */
"use strict";

const GROUPS = ["AMPR", "PRTR"];
const DAY_COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#008080", "#9a6324", "#800000", "#000075"];

/* layers offered per mode; MFV activates once 2026 IRI data exists in the export */
const MODE_LAYERS = {
  RFT: [
    { id: "friction", label: "Friction 2026" },
    { id: "collected", label: "Collected vs not" },
    { id: "sectioned", label: "Sectioned vs not" },
    { id: "d_skid", label: "Δ Friction 2026 − Skid 2025" },
  ],
  MFV: [
    { id: "iri26", label: "IRI 2026 (pending)" },
    { id: "m_collected", label: "Collected vs not (pending)" },
    { id: "d_iri", label: "Δ IRI 2026 − 2025 (pending)" },
  ],
};

const state = {
  net: "ALL",            // ALL | AMPR | PRTR
  road: "",              // "" = all roads (click a road bar to focus)
  level: "segments",     // segments | sections
  mode: "RFT",           // RFT | MFV
  layer: "friction",
  dayOn: new Set(),      // selected days
  fileSel: {},           // day -> Set(files) (subset shown for that day)
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

  buildLayerSelect();
  buildTestlinePanel();
  applyAll();
  $("#loading").style.display = "none";
}

function mergeFC(a, b) {
  return { type: "FeatureCollection", features: a.features.concat(b.features) };
}

/* ---------- paint expressions per mode/layer ---------- */
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

function paintFor(mode, layer, level) {
  if (mode === "MFV") return "#c8cdd3"; // placeholder until MFV/IRI 2026 exists
  const fricField = level === "segments" ? "friction" : "friction_aw";
  switch (layer) {
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
function legendFor(mode, layer) {
  const rows = [];
  const add = (c, t) => rows.push(`<div class="legend-row"><span class="legend-swatch" style="background:${c}"></span>${t}</div>`);
  if (mode === "MFV") {
    add("#c8cdd3", "No MFV/IRI 2026 data yet");
    rows.push(`<div class="legend-note">MFE/IRI sectioning has not been run. This layer activates automatically once 2026 IRI values are written to the inventory and exported.</div>`);
  } else if (layer === "friction") {
    add("#d73027", "≤ 30"); add("#fc8d59", "30–40"); add("#fee08b", "40–50");
    add("#d9ef8b", "50–60"); add("#91cf60", "60–75"); add("#1a9850", "≥ 75");
    add("#c8cdd3", "No value yet");
    rows.push(`<div class="legend-note">Friction number = floor(mean μ × 100), 2026 RFT</div>`);
  } else if (layer === "collected") {
    add("#27ae60", "Collected (has RFT points)"); add("#d64541", "Not collected");
  } else if (layer === "sectioned") {
    add("#27ae60", "Sectioned (friction calculated)"); add("#d64541", "Not sectioned");
    if (state.level === "sections") rows.push(`<div class="legend-note">Sections shaded by % of segment area sectioned</div>`);
  } else if (layer === "d_skid") {
    add("#b2182b", "≤ −25 (worse)"); add("#ef8a62", "−10"); add("#f7f7f7", "0");
    add("#67a9cf", "+10"); add("#2166ac", "≥ +25 (better)"); add("#c8cdd3", "No 2026 value");
    rows.push(`<div class="legend-note">Friction 2026 − Skid 2025</div>`);
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

function selectedRunKeys() {
  const keys = [];
  for (const day of state.dayOn) {
    const sel = state.fileSel[day];
    if (!sel) continue;
    for (const f of sel) keys.push(day + "|" + f);
  }
  return keys;
}

function applyAll() {
  for (const lvl of ["segments", "sections"]) {
    const vis = lvl === state.level ? "visible" : "none";
    map.setLayoutProperty(lvl + "-fill", "visibility", vis);
    map.setLayoutProperty(lvl + "-line", "visibility", vis);
    map.setFilter(lvl + "-fill", featureFilter());
    map.setFilter(lvl + "-line", featureFilter());
  }
  map.setPaintProperty(state.level + "-fill", "fill-color",
    paintFor(state.mode, state.layer, state.level));
  const runFilter = ["in", ["concat", ["get", "day"], "|", ["get", "file"]],
    ["literal", selectedRunKeys()]];
  map.setFilter("testlines-line", runFilter);
  map.setFilter("testlines-label", runFilter);
  legendFor(state.mode, state.layer);
  renderStats();
}

/* ---------- layer box (right side of map) ---------- */
function buildLayerSelect() {
  const sel = $("#layer-select");
  sel.innerHTML = MODE_LAYERS[state.mode]
    .map((l) => `<option value="${l.id}">${l.label}</option>`).join("");
  state.layer = MODE_LAYERS[state.mode][0].id;
  sel.value = state.layer;
}

$("#mode-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#mode-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.mode = e.target.dataset.mode;
  buildLayerSelect();
  applyAll();
});

$("#layer-select").addEventListener("change", (e) => {
  state.layer = e.target.value;
  applyAll();
});

/* ---------- sidebar: gauges + tables ---------- */
function netTotals() {
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
      <div class="road-bar ${state.road === r ? "selected" : ""}" data-road="${r}" title="Click to zoom to ${r}">
        <div class="rb-head">
          <span class="rb-name">${r} <small>(${g})</small><span class="zoom-ico">🔍</span></span>
          <span>${v.total_mi.toFixed(0)} mi</span>
        </div>
        <div class="rb-row"><span class="rb-tag">C</span>
          <div class="rb-track"><div class="rb-fill coll" style="width:${pc}%"></div></div>
          <span class="rb-pct">${pc.toFixed(0)}%</span></div>
        <div class="rb-row"><span class="rb-tag">S</span>
          <div class="rb-track"><div class="rb-fill sect" style="width:${ps}%"></div></div>
          <span class="rb-pct">${ps.toFixed(0)}%</span></div>
      </div>`;
    }
  }
  html += `<div class="legend-note">C = collected (orange), S = sectioned (green). Click a road to zoom; click again to clear.</div>`;
  box.innerHTML = html;
  box.querySelectorAll(".road-bar").forEach((el) =>
    el.addEventListener("click", () => {
      state.road = state.road === el.dataset.road ? "" : el.dataset.road;
      applyAll();
      if (state.road) zoomToRoad(state.road);
      else map.flyTo({ center: [-66.3, 18.35], zoom: 9 });
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

/* ---------- test lines: multi-select dropdowns ---------- */
function msddSummary(selected, total, noun) {
  if (!selected) return "None";
  if (selected === total) return `All ${noun} (${total})`;
  if (selected === 1) return `1 ${noun.replace(/s$/, "")}`;
  return `${selected} ${noun}`;
}

function buildTestlinePanel() {
  const box = $("#testline-panel");
  box.innerHTML = `
    <div class="msdd" id="dd-days">
      <button type="button" class="msdd-btn"><span class="msdd-text">None</span></button>
      <div class="msdd-panel"></div>
    </div>
    <div id="file-dds"></div>`;

  const panel = box.querySelector("#dd-days .msdd-panel");
  panel.innerHTML =
    `<label class="all-opt"><input type="checkbox" data-all="1"> All days</label>` +
    stats.days.map((d, i) => `
      <label><input type="checkbox" value="${d.day}">
        <span class="day-swatch" style="background:${DAY_COLORS[i % DAY_COLORS.length]}"></span>
        ${d.day}<span class="opt-meta">${d.total_mi.toFixed(1)} mi · ${d.n_files} runs</span></label>`).join("");

  const btn = box.querySelector("#dd-days .msdd-btn");
  btn.addEventListener("click", () => box.querySelector("#dd-days").classList.toggle("open"));

  panel.addEventListener("change", (e) => {
    const boxes = [...panel.querySelectorAll('input[type="checkbox"]:not([data-all])')];
    if (e.target.dataset.all) boxes.forEach((cb) => (cb.checked = e.target.checked));
    else panel.querySelector("[data-all]").checked = boxes.every((cb) => cb.checked);
    state.dayOn = new Set(boxes.filter((cb) => cb.checked).map((cb) => cb.value));
    // default newly enabled days to all files
    for (const day of state.dayOn) {
      if (!state.fileSel[day]) {
        const d = stats.days.find((x) => x.day === day);
        state.fileSel[day] = new Set(d.files.map((f) => f.file));
      }
    }
    btn.querySelector(".msdd-text").textContent =
      msddSummary(state.dayOn.size, stats.days.length, "days");
    renderFileDropdowns();
    applyAll();
  });

  // close dropdowns when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".msdd"))
      document.querySelectorAll(".msdd.open").forEach((el) => el.classList.remove("open"));
  });
}

function renderFileDropdowns() {
  const wrap = $("#file-dds");
  wrap.innerHTML = "";
  const dayList = stats.days.filter((d) => state.dayOn.has(d.day));
  for (const d of dayList) {
    const i = stats.days.indexOf(d);
    const sel = state.fileSel[d.day];
    const dd = document.createElement("div");
    dd.innerHTML = `
      <div class="msdd-sub-label">
        <span class="day-swatch" style="background:${DAY_COLORS[i % DAY_COLORS.length]}"></span>
        Runs on ${d.day}</div>
      <div class="msdd">
        <button type="button" class="msdd-btn"><span class="msdd-text"></span></button>
        <div class="msdd-panel">
          <label class="all-opt"><input type="checkbox" data-all="1"> All runs</label>` +
      d.files.map((f) => `
          <label><input type="checkbox" value="${f.file.replace(/"/g, "&quot;")}">
            <span>${f.file}</span><span class="opt-meta">${f.length_mi} mi</span></label>`).join("") +
      `</div></div>`;
    wrap.appendChild(dd);

    const msdd = dd.querySelector(".msdd");
    const btn = dd.querySelector(".msdd-btn");
    const panel = dd.querySelector(".msdd-panel");
    const boxes = [...panel.querySelectorAll('input[type="checkbox"]:not([data-all])')];
    const allCb = panel.querySelector("[data-all]");

    const refresh = () => {
      boxes.forEach((cb) => (cb.checked = sel.has(cb.value)));
      allCb.checked = sel.size === d.files.length;
      btn.querySelector(".msdd-text").textContent =
        msddSummary(sel.size, d.files.length, "runs");
    };
    refresh();

    btn.addEventListener("click", () => msdd.classList.toggle("open"));
    panel.addEventListener("change", (e) => {
      if (e.target.dataset.all) {
        sel.clear();
        if (e.target.checked) d.files.forEach((f) => sel.add(f.file));
      } else if (e.target.checked) sel.add(e.target.value);
      else sel.delete(e.target.value);
      refresh();
      applyAll();
    });
  }
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
}

/* ---------- header controls ---------- */
$("#network-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#network-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.net = e.target.dataset.net;
  if (state.road) {
    // drop road focus if it's not in the new network selection
    const ok = state.net === "ALL" || stats.networks[state.net].by_road[state.road];
    if (!ok) state.road = "";
  }
  applyAll();
});

$("#level-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#level-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.level = e.target.dataset.level;
  applyAll();
});

init().catch((err) => {
  $("#loading").textContent = "Failed to load: " + err.message;
  console.error(err);
});
