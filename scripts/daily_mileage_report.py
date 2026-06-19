# -*- coding: utf-8 -*-
"""Ad-hoc report: date-wise on-network mileage per NETWORKID for RFT and MFV,
read straight from the raw files (RFT_Test_Lines GDB + MFV Extracted Data CSVs).

Uses the same buffered-footprint intersection as the dashboard ETL so numbers
match the dashboard's "collected" definition. Run with arcgispro-py3.
"""
import arcpy
import csv as csvmod
import glob
import os
import re
from collections import defaultdict, OrderedDict

GIS = r"D:\Projects\Metropistas_2026\GIS"
INV_GDB = os.path.join(GIS, "Inventory_2026.gdb")
LINES_GDB = os.path.join(GIS, "RFT_Test_Lines_2026.gdb")
MFV_DIR = r"D:\Projects\Metropistas_2026\Raw Data\020 MFV\Extracted Data"

M_PER_MILE = 1609.344
FT_PER_MILE = 5280.0
FOOTPRINT_BUFFER_M = 15.0
GROUPS = ("AMPR", "PRTR")
WGS84 = arcpy.SpatialReference(4326)


def build_footprints():
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
    return foot, sr


def split_on_network(utm_shp, footprints):
    parts = {}
    for nid, foot in footprints.items():
        if utm_shp.disjoint(foot):
            continue
        mi = utm_shp.intersect(foot, 2).length / M_PER_MILE
        if mi > 0.005:
            parts[nid] = parts.get(nid, 0.0) + mi
    return parts


def rft_by_day(footprints, inv_sr):
    arcpy.env.workspace = LINES_GDB
    out = OrderedDict()
    for fc in sorted(arcpy.ListFeatureClasses() or []):
        m = re.match(r"TEST_(\d{4})(\d{2})(\d{2})_Line", fc)
        if not m:
            continue
        day = "-".join(m.groups())
        roads = defaultdict(float)
        with arcpy.da.SearchCursor(fc, ["SHAPE@"]) as cur:
            for (shp,) in cur:
                if shp is None:
                    continue
                for nid, mi in split_on_network(shp.projectAs(inv_sr), footprints).items():
                    roads[nid] += mi
        out[day] = roads
    return out


def mfv_by_day(footprints, inv_sr):
    skip = re.compile(r"(?i)faulting|inertial|event|error")
    by_day = {}
    for path in sorted(glob.glob(os.path.join(MFV_DIR, "*.csv"))):
        base = os.path.basename(path)
        if skip.search(base):
            continue
        m = re.search(r"(\d{4})[_-](\d{2})[_-](\d{2})", base)
        if not m:
            continue
        day = "-".join(m.groups())
        runs = by_day.setdefault(day, {})
        with open(path, newline="") as f:
            for row in csvmod.DictReader(f):
                fname = (row.get("RSP_FileName") or "").strip()
                if not fname:
                    continue
                try:
                    pt = (float(row["BeginLongitude"]), float(row["BeginLatitude"]))
                    end = (float(row["EndLongitude"]), float(row["EndLatitude"]))
                except (TypeError, ValueError, KeyError):
                    continue
                r = runs.setdefault(fname, {"pts": [], "last": None})
                r["pts"].append(pt)
                r["last"] = end
    out = OrderedDict()
    for day in sorted(by_day):
        roads = defaultdict(float)
        for fname, r in by_day[day].items():
            pts = r["pts"][::5]
            if r["last"]:
                pts.append(r["last"])
            if len(pts) < 2:
                continue
            line = arcpy.Polyline(
                arcpy.Array([arcpy.Point(x, y) for x, y in pts]), WGS84)
            for nid, mi in split_on_network(line.projectAs(inv_sr), footprints).items():
                roads[nid] += mi
        out[day] = roads
    return out


def group_of(footprints):
    g = {}
    for grp in GROUPS:
        fc = os.path.join(INV_GDB, "{}_2026_Inventory".format(grp))
        with arcpy.da.SearchCursor(fc, ["NETWORKID"]) as cur:
            for (nid,) in cur:
                g[nid] = grp
    return g


def emit(title, by_day, grp):
    print("\n===== {} (on-network miles) =====".format(title))
    tot_ampr = tot_prtr = 0.0
    for day, roads in by_day.items():
        if not roads:
            print("{}: (no on-network mileage)".format(day))
            continue
        parts = "  ".join("{}={:.2f}".format(n, roads[n])
                          for n in sorted(roads))
        da = sum(mi for n, mi in roads.items() if grp.get(n) == "AMPR")
        dp = sum(mi for n, mi in roads.items() if grp.get(n) == "PRTR")
        tot_ampr += da
        tot_prtr += dp
        print("{}: {}".format(day, parts))
        print("    AMPR={:.2f}  PRTR={:.2f}  day total={:.2f}".format(da, dp, da + dp))
    print("\nTOTAL {} : AMPR={:.2f}  PRTR={:.2f}  ALL={:.2f}".format(
        title, tot_ampr, tot_prtr, tot_ampr + tot_prtr))
    return tot_ampr, tot_prtr


def main():
    foot, inv_sr = build_footprints()
    grp = group_of(foot)
    rft = rft_by_day(foot, inv_sr)
    mfv = mfv_by_day(foot, inv_sr)
    ra, rp = emit("RFT", rft, grp)
    ma, mp = emit("MFV", mfv, grp)
    print("\n===== GRAND TOTAL =====")
    print("RFT  : AMPR={:.2f}  PRTR={:.2f}  ALL={:.2f}".format(ra, rp, ra + rp))
    print("MFV  : AMPR={:.2f}  PRTR={:.2f}  ALL={:.2f}".format(ma, mp, ma + mp))
    print("BOTH : ALL={:.2f}".format(ra + rp + ma + mp))


if __name__ == "__main__":
    main()
