# TeleHubX Production Start
$ErrorActionPreference = 'SilentlyContinue'
Write-Host "=== TeleHubX Production Start ===" -ForegroundColor Cyan

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# Start server (via pm2)
Write-Host "[1/2] Starting Server..." -ForegroundColor Yellow
pm2 start ecosystem.config.cjs 2>$null

Write-Host "[2/2] Starting Dashboard..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit -Command cd '$root\apps\dashboard'; npx vite --host --port 9601"

Write-Host "TeleHubX running!" -ForegroundColor Green
Write-Host "  Backend: http://localhost:9800/api/v1/health"
Write-Host "  Dashboard: http://localhost:9601"
Write-Host "  Commands: pm2 status / pm2 stop telehubx-server"
