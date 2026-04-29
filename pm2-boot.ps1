# Auto-start TeleHubX on boot
$root = "C:\AI_WORKSPACE\Telegram Auto Bot"
Set-Location $root
pm2 resurrect 2>$null
if ($LASTEXITCODE -ne 0) {
    pm2 start ecosystem.config.cjs 2>$null
}
