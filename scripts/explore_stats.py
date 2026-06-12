# Summary stats to ground dashboard metrics:
# - NETWORKID values + total length per network (AMPR / PRTR inventories)
# - friction/section status coverage on 0.05-mi segments
# - test line lengths per day/file (projected to UTM meters)
import arcpy
import json
import os
from collections import defaultdict

GIS = r"D:\Projects\Metropistas_2026\GIS"
OUT = r"D:\Projects\Metropistas_2026\Data_Collection_Dashboard\logs\explore_stats.json"
INV = os.path.join(GIS, "Inventory_2026.gdb")
LINES = os.path.join(GIS, "RFT_Test_Lines_2026.gdb")

res = {}

# --- inventory + segments per network ---
for net in ("AMPR", "PRTR"):
    for kind, fc in (("inventory", f"{net}_2026_Inventory"),
                     ("segments05", f"{net}_2026_05_segments")):
        path = os.path.join(INV, fc)
        by_nid = defaultdict(lambda: {"count": 0, "length": 0.0, "area": 0.0,
                                      "friction_n": 0, "sectioned_n": 0,
                                      "iri25_n": 0, "skid25_n": 0})
        fields = [f.name for f in arcpy.ListFields(path)]
        cur_fields = ["NETWORKID", "length", "area"]
        has_friction = "friction_section" in fields
        has_status = "section_status" in fields
        cur_fields.append("friction_section" if has_friction else "SecID")
        cur_fields.append("section_status" if has_status else "SecID")
        cur_fields += ["IRI_2025", "Skid_2025", "SecID", "PavementTy"]
        statuses = defaultdict(int)
        pavs = defaultdict(int)
        secids = set()
        with arcpy.da.SearchCursor(path, cur_fields) as cur:
            for nid, length, area, fric, stat, iri, skid, secid, pav in cur:
                b = by_nid[nid]
                b["count"] += 1
                b["length"] += length or 0
                b["area"] += area or 0
                if has_friction and fric is not None:
                    b["friction_n"] += 1
                if has_status and stat:
                    b["sectioned_n"] += 1
                    statuses[stat] += 1
                if iri is not None:
                    b["iri25_n"] += 1
                if skid is not None:
                    b["skid25_n"] += 1
                secids.add(secid)
                pavs[pav] += 1
        res[fc] = {"by_networkid": dict(by_nid), "n_secids": len(secids),
                   "statuses": dict(statuses), "pavement": dict(pavs)}

# --- test lines: per-day, per-file lengths in meters (project to UTM) ---
arcpy.env.workspace = LINES
utm = arcpy.SpatialReference(32620)  # WGS84 UTM 20N for length calc
lines = {}
for fc in (arcpy.ListFeatureClasses() or []):
    per_file = defaultdict(float)
    with arcpy.da.SearchCursor(fc, ["FILE_NAME", "SHAPE@"]) as cur:
        for fname, shp in cur:
            if shp is None:
                continue
            per_file[fname] += shp.projectAs(utm).length
    lines[fc] = {k: round(v, 1) for k, v in per_file.items()}
res["test_lines_m"] = lines

with open(OUT, "w") as f:
    json.dump(res, f, indent=2, default=str)
print("written", OUT)
