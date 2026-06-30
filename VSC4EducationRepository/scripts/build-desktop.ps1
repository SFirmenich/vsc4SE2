$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Write-Host "Building backend executable..."
Push-Location "$root\backend"
python -m pip install -r requirements.txt
python -m pip install pyinstaller
python -m PyInstaller repository_backend.spec --noconfirm
Pop-Location

Write-Host "Building frontend..."
Push-Location "$root\frontend"
npm install
npm run build
Pop-Location

Write-Host "Packaging Electron app..."
Push-Location "$root\electron"
npm install
npm run dist
Pop-Location

Write-Host "Desktop build completed. See electron\dist."
