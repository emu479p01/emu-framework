<#
.SYNOPSIS
  EmuFramework Launcher — Start / Stop the development server and client
.DESCRIPTION
  Double-click start.cmd to launch, StopApp.cmd to stop.
  Uses cmd.exe for process management — works with Windows PowerShell 5.1+.
#>
param(
  [switch]$Stop,
  [switch]$Status
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$serverPort = 3399
$clientPort = 5199
$appUrl = "http://localhost:$clientPort"
$serverTitle = "Emu-Server"
$clientTitle = "Emu-Client"

# Pinned, known-good toolchain — downloaded portably into .tools\ so a completely
# bare Windows machine (no Node/pnpm preinstalled, no admin rights) can still run this.
$nodeVersion = "24.18.0"
$pnpmVersion = "11.10.0"
$toolsDir = Join-Path $root ".tools"
$localNodeDir = Join-Path $toolsDir "node-v$nodeVersion-win-x64"
$nodeExe = Join-Path $localNodeDir "node.exe"
$corepackCmd = Join-Path $localNodeDir "corepack.cmd"
$pnpmCmd = Join-Path $localNodeDir "pnpm.cmd"

function Ensure-Node {
  if (Test-Path $nodeExe) { return }

  Write-Host "Downloading Node.js v$nodeVersion (portable, one-time, ~30MB)..." -ForegroundColor Yellow
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  $zipUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip"
  $zipPath = Join-Path $toolsDir "node-download.zip"

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
    Remove-Item $zipPath -Force
  } catch {
    Write-Host "[ERROR] Failed to download Node.js: $_" -ForegroundColor Red
    Write-Host "Check your internet connection, or install Node.js $nodeVersion manually from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
  }

  if (-not (Test-Path $nodeExe)) {
    Write-Host "[ERROR] Node.js download succeeded but node.exe was not found at the expected path." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
  }
  Write-Host "  Node.js ready." -ForegroundColor Green
}

function Ensure-Pnpm {
  if (Test-Path $pnpmCmd) {
    $currentVersion = (& $pnpmCmd --version) 2>$null
    if ($currentVersion -eq $pnpmVersion) { return }
  }

  Write-Host "Setting up pnpm v$pnpmVersion (via corepack)..." -ForegroundColor Yellow
  & $corepackCmd enable 2>&1 | Out-Null
  & $corepackCmd prepare "pnpm@$pnpmVersion" --activate 2>&1 | Out-Null

  if (-not (Test-Path $pnpmCmd)) {
    Write-Host "[ERROR] Failed to set up pnpm via corepack." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
  }
  Write-Host "  pnpm ready." -ForegroundColor Green
}

function Ensure-Prerequisites {
  Ensure-Node
  # Put our pinned Node.js first on PATH for this session (and any child processes
  # this script spawns) so `node`, `npm`, `corepack` and `pnpm` all resolve to it —
  # without touching the machine's global PATH, registry, or requiring admin rights.
  $env:PATH = "$localNodeDir;$env:PATH"
  Ensure-Pnpm
}

function Test-Port($port) {
  # Try both loopback families explicitly — dev servers (Vite in particular) can bind
  # to only ::1 or only 127.0.0.1 depending on the machine's DNS/IPv6 setup, and
  # relying on 'localhost' resolution alone caused false negatives here.
  foreach ($addr in @('127.0.0.1', '::1')) {
    try {
      $c = New-Object Net.Sockets.TcpClient
      $c.Connect($addr, $port)
      $c.Close()
      return $true
    } catch {
      continue
    }
  }
  return $false
}

function Stop-All {
  Write-Host "`nStopping EmuFramework..." -ForegroundColor Yellow
  
  # Kill by window title
  cmd /c "taskkill /fi `"WINDOWTITLE eq $serverTitle*`" /t /f 2>nul" | Out-Null
  cmd /c "taskkill /fi `"WINDOWTITLE eq $clientTitle*`" /t /f 2>nul" | Out-Null
  
  # Kill node processes on our ports (fallback)
  try {
    $pids = @()
    $pids += (Get-NetTCPConnection -LocalPort $serverPort -ErrorAction SilentlyContinue).OwningProcess
    $pids += (Get-NetTCPConnection -LocalPort $clientPort -ErrorAction SilentlyContinue).OwningProcess
    $pids | Where-Object { $_ -gt 0 } | Select-Object -Unique | ForEach-Object {
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
  } catch { }
  
  Write-Host "  All processes stopped." -ForegroundColor Green
}

function Start-App {
  Write-Host ""
  Write-Host "======================================" -ForegroundColor Cyan
  Write-Host "  EmuFramework v0.0.0.6 Launcher" -ForegroundColor Cyan
  Write-Host "======================================" -ForegroundColor Cyan
  Write-Host ""

  # Make sure Node.js + pnpm are available — downloads them portably into .tools\
  # on first run if this is a completely bare machine. No admin rights needed.
  Ensure-Prerequisites

  # Already running?
  if (Test-Port $clientPort) {
    Write-Host "App is already running!" -ForegroundColor Green
    Write-Host "Opening $appUrl ..." -ForegroundColor Gray
    Start-Process $appUrl
    Read-Host "Press Enter to exit"
    return
  }

  # Install dependencies
  if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies (first run)..." -ForegroundColor Yellow
    pnpm install
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[ERROR] pnpm install failed. Check your internet connection." -ForegroundColor Red
      Read-Host "Press Enter to exit"
      return
    }
    Write-Host "  Done." -ForegroundColor Green
  }

  # Build CLI once
  if (-not (Test-Path "packages\cli\dist\index.js")) {
    Write-Host "Building CLI tool..." -ForegroundColor Yellow
    pnpm --filter @emu/cli build 2>&1 | Out-Null
  }

  # Start server
  Write-Host "Starting API server (port $serverPort)..." -ForegroundColor Yellow
  Start-Process cmd -ArgumentList "/c", "title $serverTitle && cd /d `"$root`" && pnpm --filter @emu/server dev" -WindowStyle Minimized
  
  Start-Sleep -Seconds 3

  # Start client
  Write-Host "Starting web client (port $clientPort)..." -ForegroundColor Yellow
  Start-Process cmd -ArgumentList "/c", "title $clientTitle && cd /d `"$root`" && pnpm --filter @emu/client dev" -WindowStyle Minimized

  # Wait for client to be ready
  Write-Host "Waiting for app to be ready..." -ForegroundColor Yellow
  $ready = $false
  for ($i = 1; $i -le 90; $i++) {
    if (Test-Port $clientPort) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
    if ($i % 15 -eq 0) {
      Write-Host "  ... still waiting ($i s)" -ForegroundColor Gray
    }
  }

  if (-not $ready) {
    Write-Host ""
    Write-Host "[ERROR] App did not start within 90 seconds." -ForegroundColor Red
    Write-Host "Check the minimized cmd windows (Emu-Server, Emu-Client) for errors." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    return
  }

  Write-Host ""
  Write-Host "======================================" -ForegroundColor Green
  Write-Host "  App is ready!" -ForegroundColor Green
  Write-Host "  $appUrl              " -ForegroundColor White
  Write-Host "======================================" -ForegroundColor Green
  Write-Host "  Logins:" -ForegroundColor Gray
  Write-Host "    admin   / admin   (Admin)" -ForegroundColor Gray
  Write-Host "    manager / manager (Sales Manager)" -ForegroundColor Gray
  Write-Host "    clerk   / clerk   (Sales Clerk)" -ForegroundColor Gray
  Write-Host ""

  # Open browser
  Start-Process $appUrl
  
  Write-Host "Use StopApp.cmd to shut down the app." -ForegroundColor DarkGray
  Start-Sleep -Seconds 2
}

function Show-Status {
  $serverOk = Test-Port $serverPort
  $clientOk = Test-Port $clientPort
  Write-Host ""
  Write-Host "EmuFramework Status:" -ForegroundColor Cyan
  Write-Host "  Server (port $serverPort): $(if($serverOk){'Running'}else{'Stopped'})" -ForegroundColor $(if($serverOk){'Green'}else{'Red'})
  Write-Host "  Client (port $clientPort): $(if($clientOk){'Running'}else{'Stopped'})" -ForegroundColor $(if($clientOk){'Green'}else{'Red'})
  if ($clientOk) {
    Write-Host "  URL: $appUrl" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Press O to open browser, any other key to exit" -ForegroundColor Yellow
    $key = [Console]::ReadKey($true)
    if ($key.Key -eq 'O') {
      Start-Process $appUrl
    }
  }
}

# ── Main ──
if ($Stop) {
  Stop-All
  Start-Sleep -Seconds 2
} elseif ($Status) {
  Show-Status
} else {
  Start-App
}
