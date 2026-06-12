@echo off
rem Daily ETL + publish for the Metropistas 2026 dashboard.
rem Register with Task Scheduler, e.g. (run once from an admin prompt):
rem   schtasks /Create /TN "Metropistas Dashboard Update" /TR "D:\Projects\Metropistas_2026\Data_Collection_Dashboard\run_daily.bat" /SC DAILY /ST 18:00

setlocal
set PY="C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe"
cd /d D:\Projects\Metropistas_2026\Data_Collection_Dashboard

echo [%date% %time%] ETL start >> logs\run_daily.log
%PY% scripts\export_dashboard_data.py >> logs\run_daily.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] ETL FAILED - skipping publish >> logs\run_daily.log
  exit /b 1
)

git add docs/data
git diff --cached --quiet && (
  echo [%date% %time%] no data changes, nothing to publish >> logs\run_daily.log
  exit /b 0
)
git commit -m "Daily data update %date%" >> logs\run_daily.log 2>&1
git push >> logs\run_daily.log 2>&1
echo [%date% %time%] published >> logs\run_daily.log
endlocal
