# Inventory all geodatabases under D:\Projects\Metropistas_2026\GIS
# Lists feature classes / tables with geometry type, row count, spatial ref, fields.
import arcpy
import json
import os

GIS_ROOT = r"D:\Projects\Metropistas_2026\GIS"
OUT = r"D:\Projects\Metropistas_2026\Data_Collection_Dashboard\logs\gdb_inventory.json"

gdbs = [
    "Inventory_2026.gdb",
    "RFT_Data_2026_No_Bridge.gdb",
    "RFT_Raw_Data_2026.gdb",
    "RFT_Test_Lines_2026.gdb",
    "RFT_2026_Sectioning.gdb",
    "Metropistas_2026.gdb",
]

result = {}
for gdb in gdbs:
    ws = os.path.join(GIS_ROOT, gdb)
    if not os.path.exists(ws):
        result[gdb] = {"error": "missing"}
        continue
    arcpy.env.workspace = ws
    entry = {"feature_classes": {}, "tables": {}, "datasets": {}}
    try:
        fcs = arcpy.ListFeatureClasses() or []
        for fc in fcs:
            d = arcpy.Describe(fc)
            try:
                cnt = int(arcpy.management.GetCount(fc)[0])
            except Exception as e:
                cnt = str(e)
            entry["feature_classes"][fc] = {
                "shape": d.shapeType,
                "count": cnt,
                "sr": d.spatialReference.name,
                "fields": [(f.name, f.type) for f in arcpy.ListFields(fc)],
            }
        for tbl in (arcpy.ListTables() or []):
            try:
                cnt = int(arcpy.management.GetCount(tbl)[0])
            except Exception as e:
                cnt = str(e)
            entry["tables"][tbl] = {
                "count": cnt,
                "fields": [(f.name, f.type) for f in arcpy.ListFields(tbl)],
            }
        for ds in (arcpy.ListDatasets() or []):
            entry["datasets"][ds] = {}
            for fc in (arcpy.ListFeatureClasses(feature_dataset=ds) or []):
                d = arcpy.Describe(fc)
                try:
                    cnt = int(arcpy.management.GetCount(fc)[0])
                except Exception as e:
                    cnt = str(e)
                entry["datasets"][ds][fc] = {
                    "shape": d.shapeType,
                    "count": cnt,
                    "sr": d.spatialReference.name,
                    "fields": [(f.name, f.type) for f in arcpy.ListFields(fc)],
                }
    except Exception as e:
        entry["error"] = str(e)
    result[gdb] = entry

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(result, f, indent=2, default=str)
print("written", OUT)
