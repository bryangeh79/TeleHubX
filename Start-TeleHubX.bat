@echo off
chcp 65001 >nul
:: ============================================================
:: TeleHubX Launcher  -  double-click to start everything
:: Ports: backend 9800 / dashboard 9601 / PG 5436 / Redis 6386
:: Updated 2026-04-30
:: ============================================================

set "PROJ=C:\AI_WORKSPACE\Telegram Auto Bot"

echo.
echo =========================================
echo    TeleHubX  Launcher
echo =========================================
echo.

if not exist "%PROJ%" goto err_noproj

:: [1/3] Docker check (PG + Redis)
echo [1/3] Docker check (PG + Redis)...
docker ps 2>nul | findstr "telehubx-pg" >nul
if errorlevel 1 goto start_docker
echo       Containers already running, skip.
goto start_pm2

:start_docker
echo       Starting PG + Redis containers (detached)...
cd /d "%PROJ%"
docker compose up -d
if errorlevel 1 goto err_docker
echo       Waiting 5s for PG to initialise...
timeout /t 5 /nobreak >nul
goto start_pm2

:start_pm2
:: [2/3] pm2 services
echo.
echo [2/3] Starting pm2 services (server / dashboard / agent)...
cd /d "%PROJ%"
pm2 start ecosystem.config.cjs 2>nul
echo       pm2 OK. Run "pm2 status" to inspect.

:: [3/3] Health check on backend
echo.
echo [3/3] Waiting for backend to be ready (port 9800)...
set /a TRIES=0
:health_check
curl -s -o nul -w "%%{http_code}" http://localhost:9800/api/v1/health 2>nul | findstr "200" >nul
if not errorlevel 1 goto health_ok
set /a TRIES+=1
if %TRIES% gtr 25 goto health_timeout
timeout /t 2 /nobreak >nul
goto health_check

:health_ok
echo       Backend ready!
echo.
start "" "http://localhost:9601"
goto done

:health_timeout
echo       WARN: backend not ready after 50s, opening dashboard anyway...
start "" "http://localhost:9601"

:done
echo.
echo =========================================
echo  TeleHubX running!
echo    Dashboard  :  http://localhost:9601
echo    Backend    :  http://localhost:9800/api/v1/health
echo    Logs       :  pm2 logs
echo    Status     :  pm2 status
echo    Stop       :  double-click Stop-TeleHubX.bat
echo =========================================
echo.
pause
exit /b 0

:err_noproj
echo [ERROR] Project folder not found: %PROJ%
pause
exit /b 1

:err_docker
echo [ERROR] docker compose up failed.
echo         Is Docker Desktop running?
pause
exit /b 1
