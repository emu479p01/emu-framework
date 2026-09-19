$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($repoRoot -match '[\\/]OneDrive(?:[\\/]|$)') { throw 'Refusing to use a OneDrive workspace.' }
docker version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running.' }

function Wait-Healthy([string]$container) {
  foreach ($attempt in 1..30) {
    $status = docker inspect --format '{{.State.Health.Status}}' $container 2>$null
    if ($status -eq 'healthy') { return }
    Start-Sleep -Seconds 2
  }
  throw "Container did not become healthy: $container"
}

function File-Hash([string]$container, [string]$path) {
  return (docker exec $container node -e "const fs=require('node:fs'),c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync('$path')).digest('hex'))").Trim()
}

function Wait-Job([string]$updater, [string]$path) {
  foreach ($attempt in 1..60) {
    Start-Sleep -Seconds 2
    $text = docker exec $updater node -e "process.stdout.write(require('node:fs').readFileSync('$path','utf8'))" 2>$null
    if (-not $text) { continue }
    $state = $text | ConvertFrom-Json
    if ($state.status -in @('failed', 'succeeded')) { return $state }
  }
  throw "Timed out waiting for $path"
}

Push-Location $repoRoot
try {
  docker build --pull=false --network=none -f Dockerfile.test-unhealthy -t emuframework-local:1.0.2-unhealthy .
  if ($LASTEXITCODE -ne 0) { throw 'Could not build the offline unhealthy candidate.' }

  $env:TEST_UPDATER_TOKEN = 'local-test-token-1-0-2-change-before-sharing'
  $env:TEST_APP_IMAGE = 'ghcr.io/emu479p01/emu-framework:1.0.1'
  $env:TEST_CANDIDATE_IMAGE = 'emuframework-local:1.0.2-unhealthy'
  $env:TEST_APP_PORT = '13699'
  $env:TEST_UPDATER_PORT = '13601'
  $env:TEST_APP_CONTAINER = 'emuframework-test-1-0-2-rollback-fix-app'
  $env:TEST_UPDATER_CONTAINER = 'emuframework-test-1-0-2-rollback-fix-updater'
  docker compose --project-name emuframework-test-1-0-2-rollback-fix -f docker-compose.test.yml up -d --pull never
  if ($LASTEXITCODE -ne 0) { throw 'Rollback test stack did not start.' }
  Wait-Healthy $env:TEST_APP_CONTAINER
  $beforeUpdate = File-Hash $env:TEST_APP_CONTAINER '/data/data.db'

  $headers = @{ Authorization = "Bearer $env:TEST_UPDATER_TOKEN" }
  $updateBody = @{ jobId = "failed-update-$([Guid]::NewGuid().ToString('N'))"; version = '1.0.2' } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:13601/update' -Headers $headers -ContentType 'application/json' -Body $updateBody | Out-Null
  $updateState = Wait-Job $env:TEST_UPDATER_CONTAINER '/data/update-status.json'
  if ($updateState.status -ne 'failed' -or $updateState.rollbackStatus -ne 'succeeded' -or $updateState.recoveryRequired) { throw "Update did not roll back cleanly: $($updateState | ConvertTo-Json -Compress)" }
  Wait-Healthy $env:TEST_APP_CONTAINER
  $afterUpdate = File-Hash $env:TEST_APP_CONTAINER '/data/data.db'
  if ($beforeUpdate -ne $afterUpdate) { throw 'data.db bytes changed after failed-update rollback.' }

  $restoreId = "failed-restore-$([Guid]::NewGuid().ToString('N'))"
  docker exec $env:TEST_UPDATER_CONTAINER node -e "const fs=require('node:fs');fs.mkdirSync('/data/restore-jobs/$restoreId',{recursive:true});fs.writeFileSync('/data/restore-jobs/$restoreId/data.db','not a sqlite database')"
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the synthetic failed-restore fixture.' }
  $beforeRestore = File-Hash $env:TEST_APP_CONTAINER '/data/data.db'
  $restoreBody = @{ jobId = $restoreId; stagePath = "/data/restore-jobs/$restoreId"; components = @('data') } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:13601/restore' -Headers $headers -ContentType 'application/json' -Body $restoreBody | Out-Null
  $restoreState = Wait-Job $env:TEST_UPDATER_CONTAINER '/data/restore-status.json'
  if ($restoreState.status -ne 'failed' -or $restoreState.rollbackStatus -ne 'succeeded' -or $restoreState.recoveryRequired) { throw "Restore did not roll back cleanly: $($restoreState | ConvertTo-Json -Compress)" }
  Wait-Healthy $env:TEST_APP_CONTAINER
  $afterRestore = File-Hash $env:TEST_APP_CONTAINER '/data/data.db'
  if ($beforeRestore -ne $afterRestore) { throw 'data.db bytes changed after failed-restore rollback.' }

  Write-Host 'Failed-health update rollback and failed-restore rollback preserved byte-identical data.db.'
  Write-Host 'Rollback test containers, network, and volume were intentionally left running.'
}
finally { Pop-Location }
