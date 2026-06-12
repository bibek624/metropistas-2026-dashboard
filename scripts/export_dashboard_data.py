# -*- coding: utf-8 -*-
"""
Daily ETL for the Metropistas 2026 Data Collection Dashboard.

Reads:
  - Inventory_2026.gdb  : {AMPR,PRTR}_2026_05_segments, {AMPR,PRTR}_2026_Inventory
  - RFT_Test_Lines_2026.gdb : TEST_YYYYMMDD_Line feature classes

Writes (to docs/data/):
  - segments_{AMPR,PRTR}.geojson   0.05-mi segments, WGS84, simplified
  - sections_{AMPR,PRTR}.geojson   original sections + area-weighted friction
  - testlines.geojson              all daily runs, props: key, day, file, length_mi
  - stats.json                     progress metrics

Collected length is computed by INTERSECTING each test line with a buffered
dissolve of every road's inventory polygons (NETWORKID footprint) — one run can
contribute miles to several roads (e.g. PR2 -> PR22 -> PR18 connector runs).
Sectioned length comes from segments with a 2026 friction value.

Run with ArcGIS Pro python (arcgispro-py3).
"""
import arcpy
import datetime
import json
import os
import re
import sys
from collections import defaultdict

GIS = r"D:\Projects\Metropistas_2026\GIS"
ROOT = r"D:\Projects\Metropistas_2026\Data_Collection_Dashboard"
INV_GDB = os.path.join(GIS, "Inventory_2026.gdb")
LINES_GDB = os.path.join(GIS, "RFT_Test_Lines_2026.gdb")
DATA_DIR = os.path.join(ROOT, "docs", "data")
LOG_DIR = os.path.join(ROOT, "logs")

SQFT_TO_SQM = 0.09290304
FT_PER_MILE = 5280.0
M_PER_MILE = 1609.344
FOOTPRINT_BUFFER_M = 15.0   # tolerance for GPS offset of test lines vs lane polygons
WGS84 = arcpy.SpatialReference(4326)
GROUPS = ("AMPR", "PRTR")

# year-history columns to carry into the web data when present
# (Skid_2025 is the "Friction 2025" value — the dashboard labels it Friction)
HISTORY_FIELDS = ["IRI_2021", "IRI_2024", "IRI_2025",
                  "Skid_2021", "Skid_2024", "Skid_2025",
                  "PCI_2021", "PCI_2024", "PCI_2025"]

_log_lines = []


def log(msg):
    line = "[{}] {}".format(datetime.datetime.now().strftime("%H:%M:%S"), msg)
    print(line)
    _log_lines.append(line)


def round_coords(obj, nd=6):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(c, nd) for c in obj[:2]]
        return [round_coords(o, nd) for o in obj]
    return obj


def geom_to_geojson(shp, generalize_m=1.0):
    """Geometry (any SR) -> generalized -> WGS84 geojson geometry dict."""
    if shp is None:
        return None
    try:
        g = shp.generalize(generalize_m) if generalize_m else shp
    except Exception:
        g = shp
    gj = g.projectAs(WGS84).__geo_interface__
    gj["coordinates"] = round_coords(gj["coordinates"])
    return gj


def write_geojson(path, features):
    fc = {"type": "FeatureCollection", "features": features}
    with open(path, "w") as f:
        json.dump(fc, f, separators=(",", ":"), default=str)
    log("wrote {} ({} features, {:.1f} MB)".format(
        os.path.basename(path), len(features), os.path.getsize(path) / 1e6))


def export_network(group):
    """Export segments + sections geojson for one group; return road stats."""
    seg_fc = os.path.join(INV_GDB, "{}_2026_05_segments".format(group))
    sec_fc = os.path.join(INV_GDB, "{}_2026_Inventory".format(group))

    # ---- segments ----
    seg_names = {f.name for f in arcpy.ListFields(seg_fc)}
    sectionid_f = "SECTIONID" if "SECTIONID" in seg_names else "SecCode"
    seg_hist = [f for f in HISTORY_FIELDS if f in seg_names]
    seg_fields = ["SecID", "PID", "segment_id", "NETWORKID", sectionid_f,
                  "PavementTy", "length", "area", "Shape_Area",
                  "pt_count", "section_status", "friction_section",
                  "friction_date", "pt_filename", "pt_testlayer",
                  "section_date", "SHAPE@"] + seg_hist
    features = []
    agg = defaultdict(lambda: {"fa_sum": 0.0, "a_fric": 0.0, "a_all": 0.0,
                               "n": 0, "n_fric": 0})
    road = defaultdict(lambda: {"n_segments": 0, "n_friction": 0,
                                "sectioned_mi": 0.0})
    with arcpy.da.SearchCursor(seg_fc, seg_fields) as cur:
        for row in cur:
            (secid, pid, segid, nid, sectionid, pav, length_ft, area_ft,
             shp_area, pt_count, status, fric, fdate, ptfile, ptlayer,
             sdate, shp) = row[:17]
            hist = dict(zip(seg_hist, row[17:]))
            seg_len_mi = 0.0
            if area_ft and length_ft and shp_area:
                seg_len_mi = (shp_area / (area_ft * SQFT_TO_SQM) * length_ft
                              / FT_PER_MILE)

            a = agg[secid]
            a["n"] += 1
            a["a_all"] += shp_area or 0
            if fric is not None:
                a["n_fric"] += 1
                a["a_fric"] += shp_area or 0
                a["fa_sum"] += fric * (shp_area or 0)

            r = road[nid]
            r["n_segments"] += 1
            if fric is not None:
                r["n_friction"] += 1
                r["sectioned_mi"] += seg_len_mi

            # friction 2025 lives in the Skid_2025 column; Δ = 2026 − 2025
            fric25 = hist.get("Skid_2025")
            d_fric = (fric - fric25) if (fric is not None and fric25 is not None) else None
            tdate = None
            m = re.search(r"TEST_(\d{4})(\d{2})(\d{2})", ptlayer or "")
            if m:
                tdate = "-".join(m.groups())
            props = {
                "SecID": secid, "PID": pid, "segment_id": segid,
                "NETWORKID": nid, "SECTIONID": sectionid,
                "PavementTy": pav,
                "seg_len_mi": round(seg_len_mi, 4),
                "pt_count": pt_count, "section_status": status,
                "friction": fric,
                "friction_date": str(fdate)[:10] if fdate else None,
                "test_file": ptfile,
                "test_date": tdate,
                "section_date": str(sdate)[:10] if sdate else None,
                "d_friction": round(d_fric, 1) if d_fric is not None else None,
            }
            props.update(hist)
            features.append({"type": "Feature",
                             "geometry": geom_to_geojson(shp),
                             "properties": props})
    write_geojson(os.path.join(DATA_DIR, "segments_{}.geojson".format(group)),
                  features)

    # ---- sections (original, pre-explode) ----
    sec_names = {f.name for f in arcpy.ListFields(sec_fc)}
    sectionid_sf = "SECTIONID" if "SECTIONID" in sec_names else "SecCode"
    sec_hist = [f for f in HISTORY_FIELDS if f in sec_names]
    sec_fields = ["SecID", "PID", "NETWORKID", sectionid_sf, "SecCode",
                  "PavementTy", "length", "From__km_", "To__km_",
                  "SHAPE@"] + sec_hist
    features = []
    total_by_road = defaultdict(float)
    with arcpy.da.SearchCursor(sec_fc, sec_fields) as cur:
        for row in cur:
            (secid, pid, nid, sectionid, seccode, pav, length_ft,
             fkm, tkm, shp) = row[:10]
            hist = dict(zip(sec_hist, row[10:]))
            total_by_road[nid] += (length_ft or 0) / FT_PER_MILE
            a = agg.get(secid)
            fric_aw = None
            pct_sect = 0.0
            if a:
                if a["a_fric"] > 0:
                    fric_aw = round(a["fa_sum"] / a["a_fric"], 1)
                if a["a_all"] > 0:
                    pct_sect = round(100.0 * a["a_fric"] / a["a_all"], 1)
            fric25 = hist.get("Skid_2025")
            d_fric = (fric_aw - fric25) if (fric_aw is not None and fric25 is not None) else None
            props = {
                "SecID": secid, "PID": pid, "NETWORKID": nid,
                "SECTIONID": sectionid, "SecCode": seccode,
                "PavementTy": pav,
                "length_mi": round((length_ft or 0) / FT_PER_MILE, 3),
                "From_km": fkm, "To_km": tkm,
                "friction_aw": fric_aw, "pct_sectioned": pct_sect,
                "d_friction": round(d_fric, 1) if d_fric is not None else None,
                "n_segments": a["n"] if a else 0,
                "n_friction": a["n_fric"] if a else 0,
            }
            props.update(hist)
            features.append({"type": "Feature",
                             "geometry": geom_to_geojson(shp),
                             "properties": props})
    write_geojson(os.path.join(DATA_DIR, "sections_{}.geojson".format(group)),
                  features)

    by_road = {}
    for nid in sorted(set(list(road) + list(total_by_road))):
        r = road[nid]
        by_road[nid] = {
            "group": group,
            "total_mi": round(total_by_road.get(nid, 0), 2),
            "sectioned_mi": round(r["sectioned_mi"], 2),
            "n_segments": r["n_segments"],
            "n_friction": r["n_friction"],
        }
    return by_road


def build_footprints():
    """NETWORKID -> buffered dissolved inventory polygon (native UTM SR)."""
    foot = {}
    sr = None
    for group in GROUPS:
        fc = os.path.join(INV_GDB, "{}_2026_Inventory".format(group))
        out = r"memory\diss_{}".format(group)
        arcpy.management.Dissolve(fc, out, "NETWORKID")
        with arcpy.da.SearchCursor(out, ["NETWORKID", "SHAPE@"]) as cur:
            for nid, shp in cur:
                foot[nid] = shp.buffer(FOOTPRINT_BUFFER_M)
                sr = shp.spatialReference
        arcpy.management.Delete(out)
    log("built {} road footprints (buffer {} m)".format(
        len(foot), FOOTPRINT_BUFFER_M))
    return foot, sr


def export_testlines(footprints, inv_sr, group_of):
    """Merge all TEST_*_Line FCs; intersect runs with road footprints.
    Returns (days list, collected_by_road dict)."""
    arcpy.env.workspace = LINES_GDB
    features = []
    days = []
    collected_by_road = defaultdict(float)
    for fc in sorted(arcpy.ListFeatureClasses() or []):
        m = re.match(r"TEST_(\d{4})(\d{2})(\d{2})_Line", fc)
        if not m:
            log("skipping unrecognized FC: " + fc)
            continue
        day = "-".join(m.groups())
        files = []
        with arcpy.da.SearchCursor(fc, ["FILE_NAME", "SHAPE@"]) as cur:
            for fname, shp in cur:
                if shp is None:
                    continue
                utm_shp = shp.projectAs(inv_sr)
                length_mi = utm_shp.length / M_PER_MILE

                # split the run's length across the road footprints it crosses
                parts = []
                for nid, foot in footprints.items():
                    if utm_shp.disjoint(foot):
                        continue
                    seg = utm_shp.intersect(foot, 2)  # polyline overlap
                    mi = seg.length / M_PER_MILE
                    if mi > 0.005:
                        parts.append({"route": nid, "network": group_of[nid],
                                      "mi": round(mi, 2)})
                        collected_by_road[nid] += mi
                parts.sort(key=lambda p: -p["mi"])
                route = parts[0]["route"] if parts else None
                key = day + "|" + (fname or "")
                features.append({
                    "type": "Feature",
                    "geometry": geom_to_geojson(utm_shp, generalize_m=2.0),
                    "properties": {
                        "key": key, "day": day, "file": fname,
                        "length_mi": round(length_mi, 2),
                        "route": route,
                        "routes": json.dumps(parts),
                    },
                })
                files.append({"file": fname, "length_mi": round(length_mi, 2),
                              "route": route, "networks": parts})
        files.sort(key=lambda x: x["file"])
        days.append({"day": day,
                     "total_mi": round(sum(f["length_mi"] for f in files), 2),
                     "n_files": len(files), "files": files})
    write_geojson(os.path.join(DATA_DIR, "testlines.geojson"), features)
    return days, collected_by_road


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)
    t0 = datetime.datetime.now()
    log("ETL start")

    networks = {}
    for group in GROUPS:
        log("exporting {} ...".format(group))
        networks[group] = {"by_road": export_network(group)}

    group_of = {nid: g for g in GROUPS for nid in networks[g]["by_road"]}

    log("building road footprints + intersecting test lines ...")
    footprints, inv_sr = build_footprints()
    days, collected_by_road = export_testlines(footprints, inv_sr, group_of)

    line_total = round(sum(d["total_mi"] for d in days), 2)
    on_network = round(sum(collected_by_road.values()), 2)

    for group, g in networks.items():
        tot = sect = coll = 0.0
        for nid, r in g["by_road"].items():
            r["collected_mi"] = round(collected_by_road.get(nid, 0), 2)
            tot += r["total_mi"]
            sect += r["sectioned_mi"]
            coll += r["collected_mi"]
        g["total_mi"] = round(tot, 2)
        g["sectioned_mi"] = round(sect, 2)
        g["collected_mi"] = round(coll, 2)
        g["pct_sectioned"] = round(100 * sect / tot, 1) if tot else 0
        g["pct_collected"] = round(100 * min(coll, tot) / tot, 1) if tot else 0

    stats = {
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "networks": networks,
        "days": days,
        "line_total_mi": line_total,
        "line_on_network_mi": on_network,
        "line_off_network_mi": round(line_total - on_network, 2),
        "notes": {
            "collected_mi": "test-line miles intersecting the road's buffered "
                            "inventory footprint ({} m); one run can feed "
                            "several roads".format(FOOTPRINT_BUFFER_M),
            "sectioned_mi": "miles of 0.05-mi segments with a 2026 friction "
                            "value (area-fraction x parent length)",
        },
    }
    with open(os.path.join(DATA_DIR, "stats.json"), "w") as f:
        json.dump(stats, f, indent=1, default=str)
    log("wrote stats.json")

    log("ETL done in {:.1f}s".format(
        (datetime.datetime.now() - t0).total_seconds()))
    logname = os.path.join(LOG_DIR, "etl_{}.log".format(
        t0.strftime("%Y%m%d_%H%M%S")))
    with open(logname, "w") as f:
        f.write("\n".join(_log_lines))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        _log_lines.append(traceback.format_exc())
        with open(os.path.join(LOG_DIR, "etl_error.log"), "w") as f:
            f.write("\n".join(_log_lines))
        sys.exit(1)
