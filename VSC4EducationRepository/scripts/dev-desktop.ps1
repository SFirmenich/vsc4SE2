$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Write-Host "Starting Django backend..."
$backend = Start-Process -FilePath python -ArgumentList @("desktop_server.py") -WorkingDirectory "$root\backend" -PassThru

Write-Host "Starting Vite frontend..."
$frontend = Start-Process -FilePath npm.cmd -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1") -WorkingDirectory "$root\frontend" -PassThru

Start-Sleep -Seconds 3

Write-Host "Starting Electron..."
Push-Location "$root\electron"
npm install
npm run dev
Pop-Location

Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
Stop-Process -Id $frontend.Id -ErrorAction SilentlyContinue
