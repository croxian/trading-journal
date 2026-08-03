@echo off
set PYTHONUTF8=1
"C:\Python314\python.exe" "%~dp0fetch_market.py" upload >> "%~dp0market_fetch.log" 2>&1
