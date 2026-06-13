/* Metropistas 2026 — Data Collection Dashboard */
"use strict";

const GROUPS = ["AMPR", "PRTR"];
const DAY_COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#008080", "#9a6324", "#800000", "#000075"];

const C = {                 // palette — neutral grays + ARA navy/amber accents
  none: "#d5d9de",          // no data / not sectioned
  accent: "#2456a6",        // sectioned / positive highlight (ARA navy)
  amber: "#f0a93b",         // collected
  text: "#1d2b3d",
};

/* layers per mode (single-select radio list) */
const MODE_LAYERS = {
  RFT: [
    { id: "friction", label: "Friction 2026" },
    { id: "sectioned", label: "Sectioned vs not" },
    { id: "d_friction", label: "Δ Friction (2026 − 2025)" },
  ],
  MFV: [
    { id: "iri26", label: "IRI 2026", pending: true },
    { id: "d_iri", label: "Δ IRI 2026 − 2025", pending: true },
  ],
};

const state = {
  net: "AMPR",
  road: "",
  level: "segments",
  mode: "RFT",
  layer: "friction",
  basemap: "sat",
  showLines: true,
  dayOn: new Set(),
  runSel: new Set(),   // keys "day|file"
};

let stats = null;
let map = null;
const DATA = {};       // segments / sections / lines FeatureCollections

const $ = (sel) => document.querySelector(sel);

async function loadJSON(url) {
  const r = await fetch(url + "?v=" + Date.now());
  if (!r.ok) throw new Error(url + " → " + r.status);
  return r.json();
}

/* ============================ init ============================ */
async function init() {
  stats = await loadJSON("data/stats.json");
  $("#updated").textContent = "Updated " + stats.generated;

  map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        sat: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256, maxzoom: 19,
          attribution: "© Esri, Maxar, Earthstar Geographics",
        },
        light: {
          type: "raster",
          tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"],
          tileSize: 512,
          attribution: "© OpenStreetMap contributors © CARTO",
        },
      },
      layers: [
        { id: "basemap-sat", type: "raster", source: "sat",
          layout: { visibility: "visible" } },
        { id: "basemap-light", type: "raster", source: "light",
          layout: { visibility: "none" } },
      ],
    },
    center: [-66.3, 18.35],
    zoom: 9,
    fadeDuration: 0,
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }));
  map.on("error", (e) => console.warn("[map]", e && e.error ? e.error.message : e));

  // register before the data fetches so a 'load' fired mid-fetch can't be missed
  const mapReady = new Promise((res) => map.once("load", res));

  const [segA, segP, secA, secP, lines, linesM] = await Promise.all([
    loadJSON("data/segments_AMPR.geojson"),
    loadJSON("data/segments_PRTR.geojson"),
    loadJSON("data/sections_AMPR.geojson"),
    loadJSON("data/sections_PRTR.geojson"),
    loadJSON("data/testlines.geojson"),
    loadJSON("data/testlines_MFV.geojson").catch(() => emptyFC()),
  ]);
  DATA.segments = mergeFC(segA, segP);
  DATA.sections = mergeFC(secA, secP);
  DATA.lines = lines;
  DATA.linesMFV = linesM;

  await mapReady;

  const lineWidth = ["interpolate", ["linear"], ["zoom"],
    7, 2.4, 9.5, 1.9, 11.5, 1.1, 13.5, 0.3];

  for (const lvl of ["segments", "sections"]) {
    // maxzoom: stop re-cutting vector tiles past z14 → much smoother deep zoom
    map.addSource(lvl, { type: "geojson", data: DATA[lvl], tolerance: 0.6, maxzoom: 14 });
    // color-matched outline keeps roads visible when zoomed out
    map.addLayer({
      id: lvl + "-outline", type: "line", source: lvl,
      paint: { "line-color": C.none, "line-width": lineWidth },
      layout: { visibility: lvl === state.level ? "visible" : "none" },
    });
    map.addLayer({
      id: lvl + "-fill", type: "fill", source: lvl,
      paint: { "fill-color": C.none, "fill-opacity": 0.9 },
      layout: { visibility: lvl === state.level ? "visible" : "none" },
    });
    // white boundary so individual segments / sections read clearly when zoomed in
    map.addLayer({
      id: lvl + "-border", type: "line", source: lvl,
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.85,
        "line-width": lvl === "segments"
          ? ["interpolate", ["linear"], ["zoom"], 11, 0, 12.5, 0.4, 14, 0.9, 16, 1.7]
          : ["interpolate", ["linear"], ["zoom"], 10, 0, 12, 0.9, 14, 1.8, 16, 3],
      },
      layout: { visibility: lvl === state.level ? "visible" : "none" },
    });
    map.on("click", lvl + "-fill", (e) => selectFeature(e.features[0].properties));
    map.on("mouseenter", lvl + "-fill", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", lvl + "-fill", () => (map.getCanvas().style.cursor = ""));
  }

  // highlight outline for the currently selected segment/section
  map.addSource("sel", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "sel-outline", type: "line", source: "sel",
    paint: {
      "line-color": "#16d8f2",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 14, 4.5],
    },
    layout: { "line-join": "round" },
  });

  // selected test lines live in their own source (setData – always reliable)
  map.addSource("tl-sel", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "tl-casing", type: "line", source: "tl-sel",
    paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 5.5, 13, 7.5], "line-opacity": 0.9 },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "tl-line", type: "line", source: "tl-sel",
    // color baked into each feature (_color) — no expressions that can fail
    paint: {
      "line-color": ["get", "_color"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 7, 3, 13, 4.5],
      "line-dasharray": [2.4, 1.6],
    },
    layout: { "line-join": "round" },
  });
  // wide invisible band so hovering a run doesn't need pixel precision
  map.addLayer({
    id: "tl-hit", type: "line", source: "tl-sel",
    paint: { "line-color": "#000", "line-opacity": 0,
      "line-width": ["interpolate", ["linear"], ["zoom"], 7, 14, 13, 20] },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  // hovering a run shows its tooltip right on the line; it follows the cursor
  map.on("mousemove", "tl-hit", (e) => {
    map.getCanvas().style.cursor = "pointer";
    showLinePopup(e.features[0].properties, e.lngLat);
  });
  map.on("mouseleave", "tl-hit", () => {
    map.getCanvas().style.cursor = "";
    hideLinePopup();
  });

  selectAllRuns();   // every day's test lines visible by default

  $("#tl-toggle").addEventListener("change", (e) => {
    state.showLines = e.target.checked;
    $("#testline-panel").classList.toggle("off", !state.showLines);
    applyAll();
  });

  buildLayerList();
  buildBasemapList();
  buildTestlinePanel();
  applyAll();
  zoomToNetwork(state.net, 0);
  $("#loading").style.display = "none";
}

const mergeFC = (a, b) => ({ type: "FeatureCollection", features: a.features.concat(b.features) });
const emptyFC = () => ({ type: "FeatureCollection", features: [] });

/* ===================== paint / legend ===================== */
function colorRamp(field, stops) {
  const ramp = ["interpolate", ["linear"], ["to-number", ["get", field]]];
  stops.forEach(([v, c]) => ramp.push(v, c));
  return ["case", ["==", ["get", field], null], C.none, ramp];
}

/* red = bad, green = good; gray (C.none) stays clearly distinct for "no value" */
const FRICTION_STOPS = [
  [20, "#d73027"], [40, "#f46d43"], [50, "#fee08b"], [60, "#a6d96a"], [80, "#1a9850"]];
const DIFF_STOPS = [
  [-25, "#d73027"], [-8, "#fdae61"], [0, "#ffffbf"], [8, "#a6d96a"], [25, "#1a9850"]];

function paintFor(mode, layer, level) {
  if (mode === "MFV") return C.none;   // pending data
  const fricField = level === "segments" ? "friction" : "friction_aw";
  if (layer === "friction") return colorRamp(fricField, FRICTION_STOPS);
  if (layer === "sectioned") {
    if (level === "sections")
      return ["case", ["==", ["get", "friction_aw"], null], C.none,
        ["interpolate", ["linear"], ["get", "pct_sectioned"],
          0, C.none, 100, C.accent]];
    return ["case", ["!=", ["get", "friction"], null], C.accent, C.none];
  }
  if (layer === "d_friction") return colorRamp("d_friction", DIFF_STOPS);
  return C.none;
}

function legendFor(mode, layer) {
  const rows = [];
  const add = (c, t) => rows.push(`<div class="legend-row"><span class="legend-swatch" style="background:${c}"></span>${t}</div>`);
  if (mode === "MFV") {
    add(C.none, "No MFV/IRI 2026 data yet");
    rows.push(`<div class="legend-note">MFE/IRI sectioning has not started. These views activate automatically once 2026 IRI values exist in the inventory.</div>`);
  } else if (layer === "friction") {
    FRICTION_STOPS.forEach(([v, c], i) => add(c,
      i === 0 ? `≤ ${v}` : i === FRICTION_STOPS.length - 1 ? `≥ ${v}` : String(v)));
    add(C.none, "No value yet");
  } else if (layer === "sectioned") {
    add(C.accent, "Sectioned — friction calculated");
    add(C.none, "Not sectioned yet");
    if (state.level === "sections")
      rows.push(`<div class="legend-note">Sections shade toward blue as more of their area is sectioned.</div>`);
  } else if (layer === "d_friction") {
    DIFF_STOPS.forEach(([v, c]) => add(c, v > 0 ? `+${v}` : String(v)));
    add(C.none, "No 2026 value");
    rows.push(`<div class="legend-note">Friction 2026 − Friction 2025. Green = improved, red = dropped.</div>`);
  }
  $("#legend").innerHTML = rows.join("");
}

const dayColor = (day) => DAY_COLORS[dayIndex(day) % DAY_COLORS.length];

/* ---- mode-aware data: RFT (GDB test lines) vs MFV (20-ft CSV lines) ---- */
const modeDays = () => state.mode === "MFV"
  ? ((stats.mfv && stats.mfv.days) || []) : stats.days;
const modeLines = () => (state.mode === "MFV" ? DATA.linesMFV : DATA.lines) || emptyFC();
function roadProgress(g, r) {
  const v = stats.networks[g].by_road[r];
  if (state.mode === "MFV")   // MFV: collected known, nothing sectioned yet
    return { total: v.total_mi, coll: (stats.mfv && stats.mfv.by_road[r]) || 0, sect: 0 };
  return { total: v.total_mi, coll: v.collected_mi, sect: v.sectioned_mi };
}
function selectAllRuns() {
  state.dayOn = new Set();
  state.runSel = new Set();
  for (const d of modeDays()) {
    state.dayOn.add(d.day);
    d.files.forEach((f) => state.runSel.add(d.day + "|" + f.file));
  }
}

/* ===================== apply state ===================== */
function featureFilter() {
  const f = ["all"];
  const roads = Object.keys(stats.networks[state.net].by_road);
  f.push(["in", ["get", "NETWORKID"], ["literal", roads]]);
  if (state.road) f.push(["==", ["get", "NETWORKID"], state.road]);
  return f;
}

function applyAll() {
  const color = paintFor(state.mode, state.layer, state.level);
  for (const lvl of ["segments", "sections"]) {
    const vis = lvl === state.level ? "visible" : "none";
    for (const suffix of ["-fill", "-outline", "-border"]) {
      map.setLayoutProperty(lvl + suffix, "visibility", vis);
      map.setFilter(lvl + suffix, featureFilter());
    }
  }
  map.setPaintProperty(state.level + "-fill", "fill-color", color);
  map.setPaintProperty(state.level + "-outline", "line-color", color);

  const lineFC = {
    type: "FeatureCollection",
    features: !state.showLines ? [] : modeLines().features
      .filter((f) => state.runSel.has(f.properties.key))
      .map((f) => ({ ...f, properties: { ...f.properties, _color: dayColor(f.properties.day) } })),
  };
  map.getSource("tl-sel").setData(lineFC);
  // keep test lines (then the selection highlight) above every polygon layer
  for (const id of ["tl-casing", "tl-line", "tl-hit", "sel-outline"])
    if (map.getLayer(id)) map.moveLayer(id);

  legendFor(state.mode, state.layer);
  renderStats();
}

/* ===================== layer box ===================== */
function buildLayerList() {
  const box = $("#layer-list");
  box.innerHTML = MODE_LAYERS[state.mode].map((l, i) => `
    <label class="${i === 0 ? "checked" : ""}">
      <input type="radio" name="maplayer" value="${l.id}" ${i === 0 ? "checked" : ""}>
      ${l.label}${l.pending ? '<span class="pending">pending</span>' : ""}
    </label>`).join("");
  state.layer = MODE_LAYERS[state.mode][0].id;
  box.querySelectorAll("input").forEach((r) =>
    r.addEventListener("change", () => {
      box.querySelectorAll("label").forEach((l) => l.classList.remove("checked"));
      r.closest("label").classList.add("checked");
      state.layer = r.value;
      applyAll();
    }));
}

function buildBasemapList() {
  const box = $("#basemap-list");
  const opts = [{ id: "sat", label: "Satellite" }, { id: "light", label: "Streets (light)" }];
  box.innerHTML = opts.map((o) => `
    <label class="${state.basemap === o.id ? "checked" : ""}">
      <input type="radio" name="basemap" value="${o.id}" ${state.basemap === o.id ? "checked" : ""}>
      ${o.label}
    </label>`).join("");
  box.querySelectorAll("input").forEach((r) =>
    r.addEventListener("change", () => {
      state.basemap = r.value;
      box.querySelectorAll("label").forEach((l) => l.classList.remove("checked"));
      r.closest("label").classList.add("checked");
      map.setLayoutProperty("basemap-sat", "visibility", state.basemap === "sat" ? "visible" : "none");
      map.setLayoutProperty("basemap-light", "visibility", state.basemap === "light" ? "visible" : "none");
    }));
}

$("#mode-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#mode-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.mode = e.target.dataset.mode;
  clearSelection();
  $("#info-panel").classList.remove("open");
  selectAllRuns();        // swap to this mode's runs (RFT GDB lines / MFV CSV lines)
  buildLayerList();
  buildTestlinePanel();
  applyAll();
});

/* ===================== sidebar ===================== */
function netTotals() {
  const roads = state.road ? [state.road]
    : Object.keys(stats.networks[state.net].by_road);
  const t = { total: 0, coll: 0, sect: 0 };
  for (const r of roads) {
    if (!stats.networks[state.net].by_road[r]) continue;
    const p = roadProgress(state.net, r);
    t.total += p.total; t.coll += p.coll; t.sect += p.sect;
  }
  return t;
}

function gauge(svgId, pct, color) {
  const svg = $(svgId);
  const clamped = Math.max(0, Math.min(100, pct));
  const a = Math.PI * (1 - clamped / 100);
  const r = 80, cx = 100, cy = 100;
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  // half-circle gauge: the value arc never exceeds 180°, so large-arc is always 0
  svg.innerHTML = `
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" stroke="#e8ecf1" stroke-width="15" fill="none" stroke-linecap="round"/>
    ${clamped > 0 ? `<path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}" stroke="${color}" stroke-width="15" fill="none" stroke-linecap="round"/>` : ""}
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="27" font-weight="700" fill="${C.text}">${pct.toFixed(1)}%</text>`;
}

function renderStats() {
  const t = netTotals();
  const pctColl = t.total ? (100 * Math.min(t.coll, t.total)) / t.total : 0;
  const pctSect = t.total ? (100 * t.sect) / t.total : 0;
  $("#gauge-title").textContent = (state.road || state.net) + " progress";
  gauge("#gauge-collected", pctColl, C.amber);
  gauge("#gauge-sectioned", pctSect, C.accent);
  $("#miles-table").innerHTML = `
    <tr><td>Total network</td><td>${t.total.toFixed(1)} mi</td></tr>
    <tr><td>Collected</td><td>${t.coll.toFixed(1)} mi</td></tr>
    <tr><td>Sectioned</td><td>${t.sect.toFixed(1)} mi</td></tr>`;
  renderRoadBars();
}

function renderRoadBars() {
  const box = $("#road-bars");
  const groups = [state.net];
  let html = "";
  for (const g of groups) {
    for (const [r, v] of Object.entries(stats.networks[g].by_road)) {
      const p = roadProgress(g, r);
      const pc = p.total ? Math.min(100, (100 * p.coll) / p.total) : 0;
      const ps = p.total ? Math.min(100, (100 * p.sect) / p.total) : 0;
      // overlapped fills: draw the larger first, smaller on top so both stay visible
      const fills = [
        { cls: "coll", w: pc }, { cls: "sect", w: ps },
      ].sort((a, b) => b.w - a.w);
      html += `
      <div class="road-bar ${state.road === r ? "selected" : ""}" data-road="${r}" title="Zoom to ${r}">
        <div class="rb-head">
          <span class="rb-name">${r} <small>${g}</small></span>
          <span class="rb-mi">${v.total_mi.toFixed(0)} mi</span>
        </div>
        <div class="rb-track">
          ${fills.map((f) => `<div class="rb-fill ${f.cls}" style="width:${f.w}%"></div>`).join("")}
        </div>
        <div class="rb-labels">
          <span><span class="dot" style="background:${C.amber}"></span>C collected ${pc.toFixed(0)}%</span>
          <span><span class="dot" style="background:${C.accent}"></span>S sectioned ${ps.toFixed(0)}%</span>
        </div>
      </div>`;
    }
  }
  box.innerHTML = html;
  box.querySelectorAll(".road-bar").forEach((el) =>
    el.addEventListener("click", () => {
      state.road = state.road === el.dataset.road ? "" : el.dataset.road;
      applyAll();
      if (state.road) zoomToRoads([state.road]);
      else zoomToNetwork(state.net);
    }));
}

function zoomToRoads(roadList, duration) {
  const set = new Set(roadList);
  let minX = 180, minY = 90, maxX = -180, maxY = -90, found = false;
  for (const f of DATA[state.level].features) {
    if (!set.has(f.properties.NETWORKID) || !f.geometry) continue;
    found = true;
    walkCoords(f.geometry.coordinates, (x, y) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
  }
  if (found) map.fitBounds([[minX, minY], [maxX, maxY]],
    { padding: 60, duration: duration === undefined ? 1200 : duration });
}

function zoomToNetwork(net, duration) {
  zoomToRoads(Object.keys(stats.networks[net].by_road), duration);
}

function walkCoords(c, cb) {
  if (typeof c[0] === "number") cb(c[0], c[1]);
  else c.forEach((cc) => walkCoords(cc, cb));
}

/* ===================== test lines ===================== */
function dayIndex(day) { return modeDays().findIndex((d) => d.day === day); }

function buildTestlinePanel() {
  const box = $("#testline-panel");
  box.innerHTML = `
    <div class="msdd-label">Days</div>
    <div class="msdd" id="dd-days">
      <button type="button" class="msdd-btn"><span class="msdd-text">None selected</span></button>
      <div class="msdd-panel"></div>
    </div>
    <div class="msdd-label">Runs</div>
    <div class="msdd" id="dd-runs">
      <button type="button" class="msdd-btn"><span class="msdd-text">Select days first</span></button>
      <div class="msdd-panel"></div>
    </div>`;

  const dPanel = box.querySelector("#dd-days .msdd-panel");
  dPanel.innerHTML =
    `<label class="all-opt"><input type="checkbox" data-all="1" ${state.dayOn.size === modeDays().length ? "checked" : ""}> All days</label>` +
    modeDays().map((d, i) => `
      <label><input type="checkbox" value="${d.day}" ${state.dayOn.has(d.day) ? "checked" : ""}>
        <span class="day-swatch" style="background:${DAY_COLORS[i % DAY_COLORS.length]}"></span>
        ${d.day}<span class="opt-meta">${d.total_mi.toFixed(1)} mi · ${d.n_files} runs</span></label>`).join("");

  box.querySelectorAll(".msdd-btn").forEach((btn) =>
    btn.addEventListener("click", () => btn.parentElement.classList.toggle("open")));

  dPanel.addEventListener("change", (e) => {
    const boxes = [...dPanel.querySelectorAll('input:not([data-all])')];
    if (e.target.dataset.all) boxes.forEach((cb) => (cb.checked = e.target.checked));
    else dPanel.querySelector("[data-all]").checked = boxes.every((cb) => cb.checked);

    const newOn = new Set(boxes.filter((cb) => cb.checked).map((cb) => cb.value));
    // default newly enabled days to all runs; drop runs of disabled days
    for (const d of modeDays()) {
      if (newOn.has(d.day) && !state.dayOn.has(d.day))
        d.files.forEach((f) => state.runSel.add(d.day + "|" + f.file));
      if (!newOn.has(d.day))
        d.files.forEach((f) => state.runSel.delete(d.day + "|" + f.file));
    }
    state.dayOn = newOn;
    // the map update must run even if a UI render above ever throws
    try { updateDaysButton(); renderRunsDropdown(); } finally { applyAll(); }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".msdd"))
      document.querySelectorAll(".msdd.open").forEach((el) => el.classList.remove("open"));
  });
  updateDaysButton();
  renderRunsDropdown();
}

function updateDaysButton() {
  const n = state.dayOn.size, total = modeDays().length;
  $("#dd-days .msdd-text").textContent =
    n === 0 ? "None selected" : n === total ? `All days (${total})` : `${n} of ${total} days`;
  $("#lines-hint").textContent = n ? `${state.runSel.size} runs shown` : "";
}

/* ONE merged runs dropdown across all selected days */
function renderRunsDropdown() {
  const panel = $("#dd-runs .msdd-panel");
  const btn = $("#dd-runs .msdd-text");
  const dayList = modeDays().filter((d) => state.dayOn.has(d.day));
  const multi = dayList.length > 1;

  const runs = dayList.flatMap((d) => d.files.map((f) => ({
    key: d.day + "|" + f.file,
    label: (multi ? `[${d.day.slice(5)}] ` : "") + f.file,
    mi: f.length_mi,
    color: DAY_COLORS[dayIndex(d.day) % DAY_COLORS.length],
  })));

  if (!runs.length) {
    panel.innerHTML = "";
    btn.textContent = "Select days first";
    return;
  }
  panel.innerHTML =
    `<label class="all-opt"><input type="checkbox" data-all="1"> All runs (${runs.length})</label>` +
    runs.map((r) => `
      <label><input type="checkbox" value="${r.key.replace(/"/g, "&quot;")}">
        <span class="day-swatch" style="background:${r.color}"></span>
        <span>${r.label}</span><span class="opt-meta">${r.mi} mi</span></label>`).join("");

  const boxes = [...panel.querySelectorAll('input:not([data-all])')];
  const allCb = panel.querySelector("[data-all]");
  const refresh = () => {
    boxes.forEach((cb) => (cb.checked = state.runSel.has(cb.value)));
    const n = boxes.filter((cb) => cb.checked).length;
    allCb.checked = n === runs.length;
    btn.textContent = n === 0 ? "None" : n === runs.length ? `All runs (${runs.length})` : `${n} of ${runs.length} runs`;
    $("#lines-hint").textContent = state.dayOn.size ? `${n} runs shown` : "";
  };
  refresh();

  panel.onchange = (e) => {
    if (e.target.dataset.all) {
      boxes.forEach((cb) => {
        cb.checked = e.target.checked;
        if (e.target.checked) state.runSel.add(cb.value);
        else state.runSel.delete(cb.value);
      });
    } else if (e.target.checked) state.runSel.add(e.target.value);
    else state.runSel.delete(e.target.value);
    refresh();
    applyAll();
  };
}

/* ===================== bottom info panel ===================== */
const fmt = (v, d = 1) => (v === null || v === undefined || v === "" ? null : (+v).toFixed(d));

function barChart(entries, accentLast) {
  // entries: [{label, value}] — renders a mini bar chart, nulls shown as dashes
  const W = 46, GAP = 10, H = 64, TOP = 14;
  const vals = entries.map((e) => e.value).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return `<div class="legend-note">no data</div>`;
  const max = Math.max(...vals) || 1;
  const width = entries.length * (W + GAP);
  let x = 0, out = "";
  entries.forEach((e, i) => {
    const last = i === entries.length - 1 && accentLast;
    if (e.value === null || e.value === undefined) {
      out += `<text x="${x + W / 2}" y="${TOP + H - 4}" text-anchor="middle" font-size="11" fill="#aab6c3">–</text>`;
    } else {
      const h = Math.max(3, (e.value / max) * H);
      out += `<rect x="${x}" y="${TOP + H - h}" width="${W}" height="${h}" rx="3"
        fill="${last ? C.accent : "#b9c8d8"}"/>
        <text x="${x + W / 2}" y="${TOP + H - h - 4}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${C.text}">${(+e.value).toFixed(e.value >= 100 ? 0 : 1)}</text>`;
    }
    out += `<text x="${x + W / 2}" y="${TOP + H + 13}" text-anchor="middle" font-size="10" fill="#8a97a6">${e.label}</text>`;
    x += W + GAP;
  });
  return `<svg width="${width}" height="${TOP + H + 18}" viewBox="0 0 ${width} ${TOP + H + 18}">${out}</svg>`;
}

function showPanel(html) {
  $("#info-content").innerHTML = html;
  $("#info-panel").classList.add("open");
}
$("#info-close").addEventListener("click", () => {
  $("#info-panel").classList.remove("open");
  clearSelection();
});

function clearSelection() {
  if (map && map.getSource("sel")) map.getSource("sel").setData(emptyFC());
}

/* highlight the clicked feature (full geometry from DATA, not the tile-clipped copy) */
function selectFeature(p) {
  const feats = DATA[state.level].features;
  const f = state.level === "segments"
    ? feats.find((x) => x.properties.SecID === p.SecID && x.properties.segment_id === p.segment_id)
    : feats.find((x) => x.properties.SecID === p.SecID);
  map.getSource("sel").setData(f ? { type: "FeatureCollection", features: [f] } : emptyFC());
  showFeatureInfo(p);
}

function showFeatureInfo(p) {
  const isSeg = state.level === "segments";
  const mfv = state.mode === "MFV";
  const fric = isSeg ? p.friction : p.friction_aw;
  const chips = [];
  const chip = (k, v) => { if (v !== null && v !== undefined && v !== "") chips.push(`<span class="chip">${k} <b>${v}</b></span>`); };
  chip("SecID", p.SecID);
  chip("Pavement", p.PavementTy);
  chip("Length", isSeg ? (p.seg_len_mi != null ? p.seg_len_mi.toFixed(3) + " mi" : null) : p.length_mi + " mi");
  if (mfv) {
    // MFV/IRI collection has not started — show IRI history, 2026 stays null
    chip("IRI 2025", p.IRI_2025);
    chip("IRI 2026", "—");
  } else {
    if (isSeg) chip("Status", p.section_status || "not sectioned");
    else chip("Sectioned", p.pct_sectioned + "% · " + p.n_friction + "/" + p.n_segments + " segments");
    chip("Friction 2025", p.Skid_2025);
    chip("Friction 2026", fric ?? "—");
    chip("Δ Friction (26−25)", p.d_friction);
  }

  // metadata — label over value, compact columns (RFT collection metadata)
  const meta = [];
  if (!mfv) {
    const m = (k, v) => { if (v) meta.push(`<div class="m-item"><div class="m-k">${k}</div><div class="m-v">${v}</div></div>`); };
    m("Test file", p.test_file);
    m("Test date", p.test_date);
    m("Friction calculation date", p.friction_date);
    m("Section date", p.section_date);
  }

  // PRTR has no 2021 history — omit that column entirely when absent
  const has21 = ("IRI_2021" in p) || ("Skid_2021" in p) || ("PCI_2021" in p);
  const yrs = (entries) => has21 ? entries : entries.filter((e) => e.label !== "2021");

  const charts = [
    { title: "IRI (m/km)", entries: yrs([
      { label: "2021", value: p.IRI_2021 ?? null },
      { label: "2024", value: p.IRI_2024 ?? null },
      { label: "2025", value: p.IRI_2025 ?? null },
      { label: "2026", value: null }]), accent: mfv },
  ];
  if (!mfv) charts.push(
    { title: "Friction", entries: yrs([
      { label: "2021", value: p.Skid_2021 ?? null },
      { label: "2024", value: p.Skid_2024 ?? null },
      { label: "2025", value: p.Skid_2025 ?? null },
      { label: "2026", value: fric ?? null }]), accent: true });
  charts.push(
    { title: "PCI", entries: yrs([
      { label: "2021", value: p.PCI_2021 ?? null },
      { label: "2024", value: p.PCI_2024 ?? null },
      { label: "2025", value: p.PCI_2025 ?? null }]), accent: false });

  showPanel(`
    <div class="ip-head">
      <div class="ip-title">${p.NETWORKID} · ${p.SECTIONID || p.SecCode || p.SecID}${isSeg ? " · segment " + p.segment_id : ""}</div>
      <div class="ip-sub">${p.PID || ""}</div>
      <div class="ip-chips">${chips.join("")}</div>
    </div>
    ${meta.length ? `<div class="ip-meta">${meta.join("")}</div>` : ""}
    <div class="ip-charts">${charts.map((c) =>
      `<div class="chart-box"><div class="ch-title">${c.title}</div>${barChart(c.entries, c.accent)}</div>`).join("")}
    </div>`);
}

let linePopup = null, linePopupKey = null;
function hideLinePopup() {
  if (linePopup) { linePopup.remove(); linePopup = null; linePopupKey = null; }
}
function showLinePopup(p, lngLat) {
  if (linePopup && linePopupKey === p.key) { linePopup.setLngLat(lngLat); return; }
  let routes = [];
  try { routes = JSON.parse(p.routes || "[]"); } catch (e) { /* ignore */ }
  const rows = routes.map((r) =>
    `<tr><td>${r.route} (${r.network})</td><td>${r.mi} mi on network</td></tr>`).join("");
  hideLinePopup();
  linePopupKey = p.key;
  linePopup = new maplibregl.Popup({ maxWidth: "330px", offset: 14,
    closeButton: false, closeOnClick: false })
    .setLngLat(lngLat)
    .setHTML(`
      <div class="tlp-title">${p.file}</div>
      <div class="tlp-sub">Test date ${p.day}</div>
      <table class="ip-table">
        <tr><td>Driven</td><td>${p.length_mi} mi</td></tr>
        ${rows}
      </table>
      ${routes.length ? "" : '<div class="tlp-sub">off-network (ramp / connector)</div>'}`)
    .addTo(map);
}

/* ===================== header toggles ===================== */
$("#network-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#network-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.net = e.target.dataset.net;
  if (state.road && !stats.networks[state.net].by_road[state.road]) state.road = "";
  clearSelection();
  applyAll();   // no zoom — only individual road clicks zoom
});

$("#level-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#level-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.level = e.target.dataset.level;
  clearSelection();
  $("#info-panel").classList.remove("open");
  applyAll();
});

/* ===================== one-time password gate ===================== */
const PW_SHA256 = "98bbf8a38ea533c0a850301967bf808bfdd22dbbe4e61a329c07ee886a09879d";

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gate() {
  if (localStorage.getItem("mp26_auth") === "1") return;
  const el = $("#gate");
  el.hidden = false;
  $("#gate-pw").focus();
  await new Promise((resolve) => {
    $("#gate-box").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = $("#gate-pw").value;
      let ok = false;
      try { ok = (await sha256Hex(pw)) === PW_SHA256; }
      catch (err) { ok = pw === atob("TWV0cm9waXN0YXNfMjAyNg=="); } // http fallback
      if (ok) {
        localStorage.setItem("mp26_auth", "1");
        el.hidden = true;
        resolve();
      } else {
        $("#gate-err").textContent = "Incorrect password";
        $("#gate-pw").select();
      }
    });
  });
}

gate().then(init).catch((err) => {
  $("#loading").textContent = "Failed to load: " + err.message;
  console.error(err);
});
