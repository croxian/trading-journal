@echo off
chcp 65001 >nul
set PYTHONUTF8=1
echo ================================
echo   시세 수집 중...
echo ================================
"C:\Python314\python.exe" "%~dp0fetch_market.py" upload
echo.
echo 완료. 이제 앱에서 분석을 누르세요.
timeout /t 5 >nul
