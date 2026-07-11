param(
  [string]$Version,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repo = 'emu479p01/emu-framework'
$apiHeaders = @{ 'User-Agent' = 'EmuFramework-Updater'; 'Accept' = 'application/vnd.github+json' }
$current = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$releaseUrl = if ($Version) { "https://api.github.com/repos/$repo/releases/tags/$Version" } else { "https://api.github.com/repos/$repo/releases/latest" }
$release = Invoke-RestMethod -Uri $releaseUrl -Headers $apiHeaders
$target = ([string]$release.tag_name) -replace '^[vV]', ''
if ([version]$target -le [version]$current -and -not $Force) {
  Write-Host "EmuFramework v$current is already up to date." -ForegroundColor Green
  exit 0
}

$assetName = "emuframework-$target.zip"
$zipAsset = $release.assets | Where-Object name -eq $assetName | Select-Object -First 1
$hashAsset = $release.assets | Where-Object name -eq "$assetName.sha256" | Select-Object -First 1
if (-not $zipAsset -or -not $hashAsset) { throw "Release $target does not contain signed updater assets" }

$temp = Join-Path ([IO.Path]::GetTempPath()) "emu-update-$([guid]::NewGuid().ToString('N'))"
$download = Join-Path $temp $assetName
$expanded = Join-Path $temp 'release'
$backupRoot = Join-Path $root "backups\framework-$current-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
$mainPath = Join-Path $root 'packages\server\src\main.ts'
$isGit = Test-Path -LiteralPath (Join-Path $root '.git')

function Read-MarkerBlock([string]$Text, [string]$Name) {
  $begin = "// @emu:$Name-begin"
  $end = "// @emu:$Name-end"
  $start = $Text.IndexOf($begin)
  $finish = $Text.IndexOf($end)
  if ($start -lt 0 -or $finish -lt $start) { return $null }
  $contentStart = $start + $begin.Length
  return $Text.Substring($contentStart, $finish - $contentStart)
}
function Set-MarkerBlock([string]$Text, [string]$Name, [string]$Value) {
  if ($null -eq $Value) { return $Text }
  $begin = "// @emu:$Name-begin"
  $end = "// @emu:$Name-end"
  $start = $Text.IndexOf($begin)
  $finish = $Text.IndexOf($end)
  if ($start -lt 0 -or $finish -lt $start) { return $Text }
  return $Text.Substring(0, $start + $begin.Length) + $Value + $Text.Substring($finish)
}
function Copy-ReleaseItem([IO.FileSystemInfo]$Item, [string]$Destination) {
  if (-not $Item.PSIsContainer) {
    Copy-Item -LiteralPath $Item.FullName -Destination $Destination -Force
    return
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($child in Get-ChildItem -LiteralPath $Item.FullName -Force) {
    Copy-Item -LiteralPath $child.FullName -Destination $Destination -Recurse -Force
  }
}

try {
  New-Item -ItemType Directory -Path $temp,$expanded,$backupRoot -Force | Out-Null
  Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $download -Headers $apiHeaders
  $expected = ((Invoke-WebRequest -Uri $hashAsset.browser_download_url -Headers $apiHeaders).Content -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw 'Release checksum verification failed' }
  Expand-Archive -LiteralPath $download -DestinationPath $expanded -Force
  $source = Get-ChildItem -LiteralPath $expanded -Directory | Select-Object -First 1
  if (-not $source) { $source = Get-Item -LiteralPath $expanded }
  $sourceVersion = (Get-Content -LiteralPath (Join-Path $source.FullName 'package.json') -Raw | ConvertFrom-Json).version
  if ($sourceVersion -ne $target) { throw "Release package version $sourceVersion does not match tag $target" }

  & (Join-Path $root 'launch.ps1') -Stop
  foreach ($db in @('data.db','designer.db')) {
    $path = Join-Path $root $db
    if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination (Join-Path $backupRoot $db) -Force }
  }

  $oldMain = if (Test-Path -LiteralPath $mainPath) { Get-Content -LiteralPath $mainPath -Raw } else { '' }
  $blocks = @{}
  foreach ($name in @('app-imports','app-dirs','app-logic')) { $blocks[$name] = Read-MarkerBlock $oldMain $name }

  if ($isGit) {
    $dirty = @(& git -C $root status --porcelain --untracked-files=no)
    $unsafe = $dirty | Where-Object { $_ -notmatch 'packages/server/src/main.ts$' -and $_ -notmatch 'pnpm-lock.yaml$' }
    if ($unsafe) { throw "Framework files have local changes. Commit or revert them before updating: $($unsafe -join ', ')" }
    & git -C $root restore -- packages/server/src/main.ts pnpm-lock.yaml 2>$null
    & git -C $root fetch origin "refs/tags/$($release.tag_name):refs/tags/$($release.tag_name)"
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
    & git -C $root merge --ff-only $release.tag_name
    if ($LASTEXITCODE -ne 0) { throw 'The current Git branch cannot be fast-forwarded; update it manually' }
  } else {
    $exclude = @('.git','.tools','node_modules','apps','backups','data.db','designer.db')
    foreach ($item in Get-ChildItem -LiteralPath $source.FullName -Force) {
      if ($exclude -contains $item.Name) { continue }
      $destination = Join-Path $root $item.Name
      if (Test-Path -LiteralPath $destination) { Copy-Item -LiteralPath $destination -Destination $backupRoot -Recurse -Force }
      Copy-ReleaseItem $item $destination
    }
  }

  if (Test-Path -LiteralPath $mainPath) {
    $newMain = Get-Content -LiteralPath $mainPath -Raw
    foreach ($name in $blocks.Keys) { $newMain = Set-MarkerBlock $newMain $name $blocks[$name] }
    [IO.File]::WriteAllText($mainPath, $newMain, (New-Object Text.UTF8Encoding($false)))
  }

  $pnpm = Join-Path $root '.tools\node-v24.18.0-win-x64\pnpm.cmd'
  if (-not (Test-Path -LiteralPath $pnpm)) { $pnpm = 'pnpm' }
  & $pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
  & $pnpm typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
  & $pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'launch.ps1') -WindowStyle Hidden
  $healthy = $false
  for ($i = 0; $i -lt 90; $i++) {
    try {
      $client = New-Object Net.Sockets.TcpClient
      $client.Connect('127.0.0.1', 3399)
      $client.Close(); $healthy = $true; break
    } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $healthy) { throw 'Updated application did not pass the startup health check' }
  Write-Host "Updated EmuFramework v$current -> v$target. Backup: $backupRoot" -ForegroundColor Green
} catch {
  & (Join-Path $root 'launch.ps1') -Stop 2>$null
  if (-not $isGit -and (Test-Path -LiteralPath $backupRoot)) {
    foreach ($item in Get-ChildItem -LiteralPath $backupRoot -Force) {
      if ($item.Name -in @('data.db','designer.db')) { continue }
      Copy-ReleaseItem $item (Join-Path $root $item.Name)
    }
    Write-Host 'Restored overwritten framework files from the safety backup.' -ForegroundColor Yellow
  }
  Write-Host "[ERROR] Update failed: $_" -ForegroundColor Red
  Write-Host "Safety backup: $backupRoot" -ForegroundColor Yellow
  throw
} finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
