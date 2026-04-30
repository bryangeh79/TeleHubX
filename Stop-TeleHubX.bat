@echo off
chcp 65001 >nul
:: ============================================================
:: TeleHubX Stopper  -  stops pm2 services + optional Docker
:: Kills by port, never -IM node.exe (would kill FAhubX/WAhubX)
:: Updated 2026-04-30
:: ============================================================

echo.
echo =========================================
echo    TeleHubX  Stopper
echo =========================================
echo.

:: [1/2] Stop pm2 services
echo [1/2] Stopping pm2 services...
pm2 stop telehubx-server   2>nul && echo       telehubx-server  stopped || echo       telehubx-server  not running
pm2 stop telehubx-dashboard 2>nul && echo       telehubx-dashboard stopped || echo       telehubx-dashboard not running
pm2 stop telehubx-agent    2>nul && echo       telehubx-agent   stopped || echo       telehubx-agent   not running

:: Belt-and-suspenders: kill anything still on port 9800 or 9601
echo.
echo       Port cleanup (9800 / 9601)...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr "0.0.0.0:9800.*LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr "127.0.0.1:9800.*LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr "0.0.0.0:9601.*LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr "127.0.0.1:9601.*LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
echo       Port cleanup done.

:: [2/2] Docker (optional)
echo.
choice /C YN /N /M "[2/2] Stop Docker containers too (PG + Redis)? [Y/N]: "
if errorlevel 2 goto skip_docker
if errorlevel 1 (
    cd /d "C:\AI_WORKSPACE\Telegram Auto Bot"
    docker compose down
    echo       Docker containers stopped.
    goto end
)

:skip_docker
echo       Docker kept running  (faster restart next time).

:end
echo.
echo =========================================
echo  TeleHubX stopped.
echo  Note: FAhubX / WAhubX ports NOT touched.
echo =========================================
echo.
pause
