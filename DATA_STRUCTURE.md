# Metropistas 2026 — Data Structure Summary

_Last updated: 2026-06-12_

## Folder layout (D:\Projects\Metropistas_2026)

```
Metropistas_2026/
├── GIS/
│   ├── Inventory_2026.gdb          ← ★ inventory: original sections + 0.05-mi segments
│   ├── RFT_Raw_Data_2026.gdb       ← raw RFT points copied from server (per day)
│   ├── RFT_Data_2026_No_Bridge.gdb ← ★ points with bridge data removed (working copy)
│   ├── RFT_Test_Lines_2026.gdb     ← ★ collection-run polylines (one FC per day, FILE_NAME per run)
│   ├── RFT_2026_Sectioning.gdb     ← sectioning working copies
│   ├── Metropistas_2026.gdb        ← misc processing (bridges polygon, transects…)
│   ├── 2025_Inventory_V5_Final/    ← 2025 shapefiles (AMPR / PRTR)
│   ├── Tools/                      ← arcpy .pyt toolboxes (sectioning, friction calc, etc.)
│   └── Sectioning_Logs/            ← JSON logs per sectioning run
├── Raw Data/
│   ├── 020 MFV/                    ← MFV (IRI) raw data + MFV_Output.gdb
│   ├── 110 RFT/                    ← RFT raw daily folders (TEST_YYYYMMDD)
│   └── *.xlsx                      ← manual tracking spreadsheets
└── Data_Collection_Dashboard/      ← ★ this project
```

## Networks & roads

| Group | NETWORKID values | Sections | 0.05-mi segments | Total length |
|-------|------------------|----------|------------------|--------------|
| AMPR  | MTSPR22 (405), MTSPR5 (42) | 447 | 5,382 | 1,449,949 ft ≈ **274.6 mi** |
| PRTR  | MTSPR52 (261), MTSPR53A (106), MTSPR66 (67), MTSPR20 (62), MTSPR53B (46), MTSPR18 (5) | 547 | 11,417 | 3,113,363 ft ≈ **589.7 mi** |

(Lengths are lane-section lengths from the inventory `length` column.)

## Key feature classes

### Inventory_2026.gdb
- `AMPR_2026_Inventory` / `PRTR_2026_Inventory` — **original sections** (the pre-explode "save/SEC file"). One polygon per section. `SecID` and `PID` unique.
- `AMPR_2026_05_segments` / `PRTR_2026_05_segments` — **0.05-mi exploded segments**. Children of a section share `SecID`; `segment_id` orders them. Extra working fields written by the sectioning/friction tools:
  - `pt_filename`, `pt_testlayer`, `pt_dpnt_start`, `pt_dpnt_end`, `pt_count` — which RFT point file/layer + DATA_PNT span feeds the segment
  - `section_status` ('sectioned' | 'manually sectioned' | 'no_points'), `section_date`
  - `friction_section` (int, = floor(mean mu × 100)), `friction_date` — **2026 friction; currently RFT only**
- `*_2026_Centerline` — centerlines; `*_01_Miles` — 0.1-mi variants (not used by dashboard v1).
- Historical columns on both levels: `IRI_2021/2024/2025`, `Skid_2021/2024/2025`, `Rut_*`, `PCI_*`, `PavementTy`, `Road_Class`, `From__km_`, `To__km_`.

### Units (verified)
- `length` = **feet**, `area` = **sq ft** (lane width 12 ft; area_ft² × 0.092903 == Shape_Area m²).
- `Shape_Length` / `Shape_Area` = meters / m² (REGVEN UTM Zone 20N).
- Segment true length is NOT stored → derive: `seg_len_ft = (Shape_Area_m² / (area_ft² × 0.092903)) × length_ft` (area-fraction × parent length).

### RFT_Test_Lines_2026.gdb
- One FC per collection day: `TEST_YYYYMMDD_Line` (WGS84). Fields: `FILE_NAME` (run, e.g. `PR53A_NB_LN1_0.slf`), Shape.
- Daily totals so far (Jun 3–9): 12.1 / 62.5 / 58.0 / 53.2 / 59.6 / 66.2 / 51.3 mi ≈ **363 mi**.

### RFT_Data_2026_No_Bridge.gdb
- One point FC per day `TEST_YYYYMMDD_no_bridge` (~200–350k pts/day). Key fields: `DATA_PNT`, `FILE_NAME`, `MU`, `AC_mu_tgt_spd`, `PC_mu_tgt_spd`, `SecID`, `segment_id`. Too large for the dashboard — used upstream by the friction tool only.

## Current progress snapshot (2026-06-12)

| NETWORKID | segments | with friction | section_status set |
|-----------|----------|---------------|--------------------|
| MTSPR22   | 5,096    | 2,375         | 3,487 |
| MTSPR5    | 286      | 0             | 0 |
| MTSPR53A  | 1,986    | 1,755         | 1,758 |
| MTSPR66   | 1,068    | 403           | 415 |
| MTSPR52 / 53B / 20 / 18 | — | 0 | 0 |

MFV (IRI) sectioning has **not** started — 2026 IRI columns don't exist yet; dashboard treats MFV as a future layer.

## Daily pipeline (upstream of dashboard)

1. Field crew collects (RFT + MFV), uploads to server.
2. Copied into `RFT_Raw_Data_2026.gdb` (`TEST_YYYYMMDD` points + `_Line` polylines).
3. Bridge points removed → `RFT_Data_2026_No_Bridge.gdb` (`_no_bridge`).
4. Sectioning tools assign points to 0.05-mi segments; `Calculate_Mu` writes `friction_section`/`friction_date`.
5. Test lines copied to `RFT_Test_Lines_2026.gdb`.
