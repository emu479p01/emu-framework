param([switch]$SkipSourceGates)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($repoRoot -match '[\\/]OneDrive(?:[\\/]|$)') { throw 'Refusing to use a OneDrive workspace.' }

$node = Join-Path $repoRoot '.tools\node-v24.18.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Bundled Node 24.18.0 is missing; no download was attempted.' }

$unexpectedCache = 'C:\Users\USER\AppData\Local\node\corepack\v1\pnpm\11.12.0'
if (Test-Path -LiteralPath $unexpectedCache) { throw "Unexpected Corepack cache exists at the approved cleanup path: $unexpectedCache" }

if (-not $SkipSourceGates) {
  & $node (Join-Path $repoRoot 'scripts\verify-offline.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Offline source verification failed.' }
}

docker version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running. Start it manually; no service was started and no image was pulled.' }

$baseApp = 'ghcr.io/emu479p01/emu-framework:1.0.1'
$baseUpdater = 'ghcr.io/emu479p01/emu-framework-updater:1.0.1'
foreach ($image in @($baseApp, $baseUpdater)) {
  docker image inspect $image *> $null
  if ($LASTEXITCODE -ne 0) { throw "Required cached image is missing: $image. Offline mode will not pull it." }
}

Push-Location $repoRoot
try {
  docker build --pull=false --network=none --build-arg "BASE_IMAGE=$baseApp" -f Dockerfile.test-overlay -t emuframework-local:1.0.2-test .
  if ($LASTEXITCODE -ne 0) { throw 'Offline application overlay build failed.' }
  docker build --pull=false --network=none --build-arg "BASE_IMAGE=$baseUpdater" -f Dockerfile.updater.test-overlay -t emuframework-updater-local:1.0.2-test .
  if ($LASTEXITCODE -ne 0) { throw 'Offline updater overlay build failed.' }

  $env:TEST_UPDATER_TOKEN = 'local-test-token-1-0-2-change-before-sharing'
  $env:TEST_APP_IMAGE = 'emuframework-local:1.0.2-test'
  $env:TEST_APP_PORT = '13399'
  $env:TEST_UPDATER_PORT = '13400'
  $env:TEST_APP_CONTAINER = 'emuframework-test-1-0-2-app'
  $env:TEST_UPDATER_CONTAINER = 'emuframework-test-1-0-2-updater'
  docker compose --project-name emuframework-test-1-0-2 -f docker-compose.test.yml up -d --pull never
  if ($LASTEXITCODE -ne 0) { throw 'Local test stack did not start.' }

  $healthy = $false
  foreach ($attempt in 1..30) {
    $status = docker inspect --format '{{.State.Health.Status}}' $env:TEST_APP_CONTAINER 2>$null
    if ($status -eq 'healthy') { $healthy = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $healthy) { throw 'Local test application did not become healthy. Containers and volumes were left intact for inspection.' }
  Write-Host 'Fresh-install acceptance stack is healthy at http://127.0.0.1:13399'

  $env:TEST_APP_IMAGE = $baseApp
  $env:TEST_APP_PORT = '13499'
  $env:TEST_UPDATER_PORT = '13401'
  $env:TEST_APP_CONTAINER = 'emuframework-test-1-0-2-upgrade-app'
  $env:TEST_UPDATER_CONTAINER = 'emuframework-test-1-0-2-upgrade-updater'
  docker compose --project-name emuframework-test-1-0-2-upgrade -f docker-compose.test.yml up -d --pull never
  if ($LASTEXITCODE -ne 0) { throw 'Upgrade test stack did not start.' }
  $upgradeReady = $false
  foreach ($attempt in 1..30) {
    $status = docker inspect --format '{{.State.Health.Status}}' $env:TEST_APP_CONTAINER 2>$null
    if ($status -eq 'healthy') { $upgradeReady = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $upgradeReady) { throw 'Previous-release container did not become healthy. Test resources were left intact.' }

  $headers = @{ Authorization = "Bearer $env:TEST_UPDATER_TOKEN" }
  $body = @{ jobId = "offline-$([Guid]::NewGuid().ToString('N'))"; version = '1.0.2' } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:13401/update' -Headers $headers -ContentType 'application/json' -Body $body | Out-Null
  $upgradePassed = $false
  foreach ($attempt in 1..60) {
    Start-Sleep -Seconds 2
    $stateText = docker exec $env:TEST_UPDATER_CONTAINER node -e "process.stdout.write(require('node:fs').readFileSync('/data/update-status.json','utf8'))" 2>$null
    if (-not $stateText) { continue }
    $state = $stateText | ConvertFrom-Json
    if ($state.status -eq 'succeeded') { $upgradePassed = $true; break }
    if ($state.status -eq 'failed') { throw "Local-image upgrade failed in phase $($state.phase): $($state.error)" }
  }
  if (-not $upgradePassed) { throw 'Local-image upgrade timed out. Test resources were left intact.' }
  Write-Host 'Upgrade through updater local-image mode passed at http://127.0.0.1:13499'
  Write-Host 'Both test stacks, their networks, and their volumes were intentionally left running and were not removed.'
}
finally {
  Pop-Location
}
