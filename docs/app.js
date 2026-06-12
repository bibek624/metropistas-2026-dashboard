/* Metropistas 2026 — Data Collection Dashboard */
"use strict";

const GROUPS = ["AMPR", "PRTR"];
const DAY_COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#008080", "#9a6324", "#800000", "#000075"];

const C = {                 // palette — neutral grays + blue/amber accents
  none: "#d5d9de",          // no data / not sectioned
  accent: "#2e86de",        // sectioned / positive highlight
  amber: "#f0a93b",         // collected
  text: "#1d2b3d",
};

/* layers per mode (single-select radio list) */
const MODE_LAYERS = {
  RFT: [
    { id: "friction", label: "Friction 2026" },
    { id: "sectioned", label: "Sectioned vs not" },
    { id: "d_skid", label: "Δ Friction 2026 − Skid 2025" },
  ],
  MFV: [
    { id: "iri26", label: "IRI 2026", pending: true },
    { id: "d_iri", label: "Δ IRI 2026 − 2025", pending: true },
  ],
};

const state = {
  net: "ALL",
  road: "",
  level: "segments",
  mode: "RFT",
  layer: "friction",
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
  DATA.segments = mergeFC(segA, segP);
  DATA.sections = mergeFC(secA, secP);
  DATA.lines = lines;

  await new Promise((res) => (map.loaded() ? res() : map.on("load", res)));

  const lineWidth = ["interpolate", ["linear"], ["zoom"],
    7, 2.4, 9.5, 1.9, 11.5, 1.1, 13.5, 0.3];

  for (const lvl of ["segments", "sections"]) {
    map.addSource(lvl, { type: "geojson", data: DATA[lvl], tolerance: 0.6 });
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
    map.on("click", lvl + "-fill", (e) => showFeatureInfo(e.features[0].properties));
    map.on("mouseenter", lvl + "-fill", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", lvl + "-fill", () => (map.getCanvas().style.cursor = ""));
  }

  // selected test lines live in their own source (setData – always reliable)
  map.addSource("tl-sel", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "tl-casing", type: "line", source: "tl-sel",
    paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 5.5, 13, 7.5], "line-opacity": 0.9 },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "tl-line", type: "line", source: "tl-sel",
    paint: { "line-color": dayColorExpr(), "line-width": ["interpolate", ["linear"], ["zoom"], 7, 3, 13, 4.5] },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "tl-label", type: "symbol", source: "tl-sel",
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "file"],
      "text-size": 10.5,
      "text-font": ["Noto Sans Regular"],
    },
    paint: { "text-color": "#1d2b3d", "text-halo-color": "#fff", "text-halo-width": 1.3 },
  });
  map.on("click", "tl-line", (e) => {
    showLineInfo(e.features[0].properties);
    e.originalEvent.cancelBubble = true;
  });
  map.on("mouseenter", "tl-line", () => (map.getCanvas().style.cursor = "pointer"));

  buildLayerList();
  buildTestlinePanel();
  applyAll();
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

const FRICTION_STOPS = [
  [20, "#c0622f"], [40, "#e2b25c"], [50, "#e8e3d4"], [60, "#86b1da"], [80, "#1e62a8"]];
const DIFF_STOPS = [
  [-25, "#b35806"], [-8, "#f1a340"], [0, "#f4f1ea"], [8, "#998ec3"], [25, "#542788"]];

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
  if (layer === "d_skid") return colorRamp("d_skid", DIFF_STOPS);
  return C.none;
}

function legendFor(mode, layer) {
  const rows = [];
  const add = (c, t) => rows.push(`<div class="legend-row"><span class="legend-swatch" style="background:${c}"></span>${t}</div>`);
  if (mode === "MFV") {
    add(C.none, "No MFV/IRI 2026 data yet");
    rows.push(`<div class="legend-note">MFE/IRI sectioning has not started. These layers activate automatically once 2026 IRI values exist in the inventory.</div>`);
  } else if (layer === "friction") {
    FRICTION_STOPS.forEach(([v, c], i) => add(c,
      i === 0 ? `≤ ${v}` : i === FRICTION_STOPS.length - 1 ? `≥ ${v}` : String(v)));
    add(C.none, "No value yet");
    rows.push(`<div class="legend-note">Friction number = floor(mean μ × 100), RFT 2026. Low values (orange) need attention.</div>`);
  } else if (layer === "sectioned") {
    add(C.accent, "Sectioned — friction calculated");
    add(C.none, "Not sectioned yet");
    if (state.level === "sections")
      rows.push(`<div class="legend-note">Sections shade toward blue as more of their area is sectioned.</div>`);
  } else if (layer === "d_skid") {
    DIFF_STOPS.forEach(([v, c]) => add(c, v > 0 ? `+${v}` : String(v)));
    add(C.none, "No 2026 value");
    rows.push(`<div class="legend-note">Friction 2026 − Skid 2025. Purple = improved, orange = dropped.</div>`);
  }
  $("#legend").innerHTML = rows.join("");
}

function dayColorExpr() {
  const expr = ["match", ["get", "day"]];
  stats.days.forEach((d, i) => expr.push(d.day, DAY_COLORS[i % DAY_COLORS.length]));
  expr.push("#555");
  return expr;
}

/* ===================== apply state ===================== */
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
  const color = paintFor(state.mode, state.layer, state.level);
  for (const lvl of ["segments", "sections"]) {
    const vis = lvl === state.level ? "visible" : "none";
    for (const suffix of ["-fill", "-outline"]) {
      map.setLayoutProperty(lvl + suffix, "visibility", vis);
      map.setFilter(lvl + suffix, featureFilter());
    }
  }
  map.setPaintProperty(state.level + "-fill", "fill-color", color);
  map.setPaintProperty(state.level + "-outline", "line-color", color);

  map.getSource("tl-sel").setData({
    type: "FeatureCollection",
    features: DATA.lines.features.filter((f) => state.runSel.has(f.properties.key)),
  });

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

$("#mode-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#mode-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.mode = e.target.dataset.mode;
  buildLayerList();
  applyAll();
});

/* ===================== sidebar ===================== */
function netTotals() {
  let roads;
  if (state.road) {
    roads = GROUPS.filter((g) => stats.networks[g].by_road[state.road])
      .map((g) => [g, state.road]);
  } else if (state.net === "ALL") {
    roads = GROUPS.flatMap((g) => Object.keys(stats.networks[g].by_road).map((r) => [g, r]));
  } else {
    roads = Object.keys(stats.networks[state.net].by_road).map((r) => [state.net, r]);
  }
  const t = { total: 0, coll: 0, sect: 0 };
  for (const [g, r] of roads) {
    const v = stats.networks[g].by_road[r];
    t.total += v.total_mi; t.coll += v.collected_mi; t.sect += v.sectioned_mi;
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
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" stroke="#e8ecf1" stroke-width="15" fill="none" stroke-linecap="round"/>
    ${clamped > 0 ? `<path d="M ${cx - r} ${cy} A ${r} ${r} 0 ${large} 1 ${x} ${y}" stroke="${color}" stroke-width="15" fill="none" stroke-linecap="round"/>` : ""}
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="27" font-weight="700" fill="${C.text}">${pct.toFixed(1)}%</text>`;
}

function renderStats() {
  const t = netTotals();
  const pctColl = t.total ? (100 * Math.min(t.coll, t.total)) / t.total : 0;
  const pctSect = t.total ? (100 * t.sect) / t.total : 0;
  $("#gauge-title").textContent =
    (state.road || (state.net === "ALL" ? "All networks" : state.net)) + " progress";
  gauge("#gauge-collected", pctColl, C.amber);
  gauge("#gauge-sectioned", pctSect, C.accent);
  $("#miles-table").innerHTML = `
    <tr><td>Total network</td><td>${t.total.toFixed(1)} mi</td></tr>
    <tr><td>Collected</td><td>${t.coll.toFixed(1)} mi</td></tr>
    <tr><td>Sectioned</td><td>${t.sect.toFixed(1)} mi</td></tr>` +
    (!state.road && state.net === "ALL"
      ? `<tr><td>Driven off-network (ramps etc.)</td><td>${stats.line_off_network_mi.toFixed(1)} mi</td></tr>` : "");
  renderRoadBars();
}

function renderRoadBars() {
  const box = $("#road-bars");
  const groups = state.net === "ALL" ? GROUPS : [state.net];
  let html = "";
  for (const g of groups) {
    for (const [r, v] of Object.entries(stats.networks[g].by_road)) {
      const pc = v.total_mi ? Math.min(100, (100 * v.collected_mi) / v.total_mi) : 0;
      const ps = v.total_mi ? Math.min(100, (100 * v.sectioned_mi) / v.total_mi) : 0;
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

/* ===================== test lines ===================== */
function dayIndex(day) { return stats.days.findIndex((d) => d.day === day); }

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
    `<label class="all-opt"><input type="checkbox" data-all="1"> All days</label>` +
    stats.days.map((d, i) => `
      <label><input type="checkbox" value="${d.day}">
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
    for (const d of stats.days) {
      if (newOn.has(d.day) && !state.dayOn.has(d.day))
        d.files.forEach((f) => state.runSel.add(d.day + "|" + f.file));
      if (!newOn.has(d.day))
        d.files.forEach((f) => state.runSel.delete(d.day + "|" + f.file));
    }
    state.dayOn = newOn;
    updateDaysButton();
    renderRunsDropdown();
    applyAll();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".msdd"))
      document.querySelectorAll(".msdd.open").forEach((el) => el.classList.remove("open"));
  });
  renderRunsDropdown();
}

function updateDaysButton() {
  const n = state.dayOn.size, total = stats.days.length;
  $("#dd-days .msdd-text").textContent =
    n === 0 ? "None selected" : n === total ? `All days (${total})` : `${n} of ${total} days`;
  $("#lines-hint").textContent = n ? `${state.runSel.size} runs shown` : "";
}

/* ONE merged runs dropdown across all selected days */
function renderRunsDropdown() {
  const panel = $("#dd-runs .msdd-panel");
  const btn = $("#dd-runs .msdd-text");
  const dayList = stats.days.filter((d) => state.dayOn.has(d.day));
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
$("#info-close").addEventListener("click", () => $("#info-panel").classList.remove("open"));

function showFeatureInfo(p) {
  const isSeg = state.level === "segments";
  const fric = isSeg ? p.friction : p.friction_aw;
  const chips = [];
  const chip = (k, v) => { if (v !== null && v !== undefined && v !== "") chips.push(`<span class="chip">${k} <b>${v}</b></span>`); };
  chip("Pavement", p.PavementTy);
  chip("Length", isSeg ? (p.seg_len_mi != null ? p.seg_len_mi.toFixed(3) + " mi" : null) : p.length_mi + " mi");
  if (isSeg) chip("Status", p.section_status || "not sectioned");
  else chip("Sectioned", p.pct_sectioned + "% · " + p.n_friction + "/" + p.n_segments + " segments");
  chip("Friction 2026", fric ?? "—");
  if (isSeg && p.friction_date) chip("Friction date", p.friction_date);
  chip("Δ vs Skid 2025", p.d_skid);

  const charts = [
    { title: "IRI (m/km)", entries: [
      { label: "2021", value: p.IRI_2021 ?? null },
      { label: "2024", value: p.IRI_2024 ?? null },
      { label: "2025", value: p.IRI_2025 ?? null },
      { label: "2026", value: null }], accent: false },
    { title: "Skid / Friction", entries: [
      { label: "2021", value: p.Skid_2021 ?? null },
      { label: "2024", value: p.Skid_2024 ?? null },
      { label: "2025", value: p.Skid_2025 ?? null },
      { label: "2026", value: fric ?? null }], accent: true },
    { title: "Rutting", entries: [
      { label: "2021", value: p.Rut_2021 ?? null },
      { label: "2024", value: p.Rut_2024 ?? null },
      { label: "2025", value: p.Rut_2025 ?? null }], accent: false },
  ];
  showPanel(`
    <div class="ip-title">${p.NETWORKID} · ${p.SECTIONID || p.SecCode || p.SecID}${isSeg ? " · segment " + p.segment_id : ""}</div>
    <div class="ip-sub">${p.PID || ""}</div>
    <div class="ip-chips">${chips.join("")}</div>
    <div class="ip-charts">${charts.map((c) =>
      `<div class="chart-box"><div class="ch-title">${c.title}</div>${barChart(c.entries, c.accent)}</div>`).join("")}
    </div>`);
}

function showLineInfo(p) {
  let routes = [];
  try { routes = JSON.parse(p.routes || "[]"); } catch (e) { /* ignore */ }
  const rows = routes.map((r) =>
    `<tr><td>${r.route} (${r.network})</td><td>${r.mi} mi on network</td></tr>`).join("");
  showPanel(`
    <div class="ip-title">${p.file}</div>
    <div class="ip-sub">Test run · ${p.day}</div>
    <div class="ip-chips">
      <span class="chip">Driven <b>${p.length_mi} mi</b></span>
      ${routes.length ? "" : '<span class="chip">off-network (ramp / connector)</span>'}
    </div>
    ${rows ? `<table class="ip-table">${rows}</table>` : ""}`);
}

/* ===================== header toggles ===================== */
$("#network-toggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("#network-toggle .active").classList.remove("active");
  e.target.classList.add("active");
  state.net = e.target.dataset.net;
  if (state.road) {
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
