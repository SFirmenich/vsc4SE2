$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"

$backendHost = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "127.0.0.1" }
$backendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8000" }
$frontendHost = if ($env:FRONTEND_HOST) { $env:FRONTEND_HOST } else { "127.0.0.1" }
$frontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "5173" }
if (-not $env:VITE_API_BASE) {
    $env:VITE_API_BASE = "http://${backendHost}:${backendPort}/api"
}

function Resolve-Python {
    if ($env:PYTHON) {
        return $env:PYTHON
    }

    $windowsVenvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
    if (Test-Path $windowsVenvPython) {
        return $windowsVenvPython
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }

    $python3 = Get-Command python3 -ErrorAction SilentlyContinue
    if ($python3) {
        return $python3.Source
    }

    throw "Python was not found. Create backend\.venv or set PYTHON to a Python executable."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found in PATH."
}

if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "Frontend dependencies are missing. Run this first:"
    Write-Host "  cd `"$frontendDir`"; npm install"
    exit 1
}

$python = Resolve-Python
$backend = $null
$frontend = $null

try {
    Write-Host "Using Python: $python"
    Write-Host "Backend:  http://${backendHost}:${backendPort}"
    Write-Host "Frontend: http://${frontendHost}:${frontendPort}"
    Write-Host "API base: $env:VITE_API_BASE"
    Write-Host ""

    Push-Location $backendDir
    & $python manage.py migrate
    Pop-Location

    Write-Host "Starting Django backend..."
    $backend = Start-Process `
        -FilePath $python `
        -ArgumentList @("manage.py", "runserver", "${backendHost}:${backendPort}") `
        -WorkingDirectory $backendDir `
        -PassThru `
        -NoNewWindow

    Write-Host "Starting Vite frontend..."
    $npmCommand = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } else { "npm" }
    $frontend = Start-Process `
        -FilePath $npmCommand `
        -ArgumentList @("run", "dev", "--", "--host", $frontendHost, "--port", $frontendPort) `
        -WorkingDirectory $frontendDir `
        -PassThru `
        -NoNewWindow

    Write-Host ""
    Write-Host "Both services are running. Press Ctrl+C to stop them."

    while ($true) {
        if ($backend.HasExited) {
            throw "Backend process stopped with exit code $($backend.ExitCode)."
        }
        if ($frontend.HasExited) {
            throw "Frontend process stopped with exit code $($frontend.ExitCode)."
        }
        Start-Sleep -Seconds 1
    }
}
finally {
    Write-Host ""
    Write-Host "Stopping VSCode4Education Repository dev services..."

    if ($frontend -and -not $frontend.HasExited) {
        Stop-Process -Id $frontend.Id -ErrorAction SilentlyContinue
    }
    if ($backend -and -not $backend.HasExited) {
        Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
    }
}
