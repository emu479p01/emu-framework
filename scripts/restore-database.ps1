param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backup = [IO.Path]::GetFullPath($BackupPath)
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { throw "Backup not found: $backup" }

$dataPath = if ($env:EMU_DB_PATH) { [IO.Path]::GetFullPath($env:EMU_DB_PATH) } else { Join-Path $root 'data.db' }
$designerPath = if ($env:EMU_DESIGNER_DB_PATH) { [IO.Path]::GetFullPath($env:EMU_DESIGNER_DB_PATH) } else { Join-Path $root 'designer.db' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$safeBackupDir = Join-Path $root "backups\pre-restore-$stamp"
$temp = Join-Path ([IO.Path]::GetTempPath()) "emu-restore-$([guid]::NewGuid().ToString('N'))"
$zip = Join-Path $temp 'backup.zip'
$expanded = Join-Path $temp 'expanded'

try {
  & (Join-Path $root 'launch.ps1') -Stop
  New-Item -ItemType Directory -Path $temp,$expanded,$safeBackupDir -Force | Out-Null
  Copy-Item -LiteralPath $backup -Destination $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $expanded -Force

  $allowed = @('manifest.json','data.db','designer.db')
  $entries = Get-ChildItem -LiteralPath $expanded -Recurse -File
  foreach ($entry in $entries) {
    $relative = [IO.Path]::GetRelativePath($expanded, $entry.FullName)
    if ($allowed -notcontains $relative) { throw "Unsafe or unexpected backup entry: $relative" }
  }
  foreach ($required in $allowed) {
    if (-not (Test-Path -LiteralPath (Join-Path $expanded $required) -PathType Leaf)) { throw "Backup is missing $required" }
  }

  $manifest = Get-Content -LiteralPath (Join-Path $expanded 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.format -ne 'emuframework-backup' -or $manifest.schemaVersion -ne 1) { throw 'Unsupported backup format' }
  foreach ($file in $manifest.files) {
    $candidate = Join-Path $expanded $file.name
    $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $file.sha256) { throw "Checksum failed for $($file.name)" }
  }

  $node = if (Test-Path -LiteralPath (Join-Path $root '.tools\node-v24.18.0-win-x64\node.exe')) {
    Join-Path $root '.tools\node-v24.18.0-win-x64\node.exe'
  } else { 'node' }
  & $node (Join-Path $root 'scripts\validate-sqlite.mjs') (Join-Path $expanded 'data.db') (Join-Path $expanded 'designer.db')
  if ($LASTEXITCODE -ne 0) { throw 'SQLite integrity validation failed' }

  foreach ($path in @($dataPath,$designerPath)) {
    $parent = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination (Join-Path $safeBackupDir ([IO.Path]::GetFileName($path))) -Force }
    foreach ($suffix in @('-wal','-shm')) { Remove-Item -LiteralPath "$path$suffix" -Force -ErrorAction SilentlyContinue }
  }

  Copy-Item -LiteralPath (Join-Path $expanded 'data.db') -Destination "$dataPath.new" -Force
  Copy-Item -LiteralPath (Join-Path $expanded 'designer.db') -Destination "$designerPath.new" -Force
  Move-Item -LiteralPath "$dataPath.new" -Destination $dataPath -Force
  Move-Item -LiteralPath "$designerPath.new" -Destination $designerPath -Force
  if (-not $SkipRestart) {
    Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'launch.ps1') -WindowStyle Hidden
    $healthy = $false
    for ($i = 0; $i -lt 90; $i++) {
      try {
        $client = New-Object Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', 3399)
        $client.Close()
        $healthy = $true
        break
      } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $healthy) {
      & (Join-Path $root 'launch.ps1') -Stop
      $oldData = Join-Path $safeBackupDir ([IO.Path]::GetFileName($dataPath))
      $oldDesigner = Join-Path $safeBackupDir ([IO.Path]::GetFileName($designerPath))
      if (Test-Path -LiteralPath $oldData) { Copy-Item -LiteralPath $oldData -Destination $dataPath -Force }
      if (Test-Path -LiteralPath $oldDesigner) { Copy-Item -LiteralPath $oldDesigner -Destination $designerPath -Force }
      throw 'Restored databases did not pass the startup health check; previous databases were put back'
    }
  }
  Write-Host "Database restore completed. Previous files: $safeBackupDir" -ForegroundColor Green
} catch {
  Write-Host "[ERROR] Restore failed: $_" -ForegroundColor Red
  throw
} finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
