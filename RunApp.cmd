@echo off
rem ── EmuFramework launcher ─ double-click to start everything ──
title EmuFramework Launcher
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pnpm not found in PATH. Install Node.js + pnpm first.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call pnpm install
)

rem already running? just open the browser (vite may bind IPv6 ::1, so probe "localhost")
powershell -NoProfile -Command "try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('localhost',5199); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 (
  echo App is already running - opening browser...
  start http://localhost:5199
  exit /b 0
)

echo Starting API server ^(port 3399^)...
start "Emu Server" /min cmd /k "cd /d "%~dp0" && pnpm --filter @emu/server dev"

echo Starting web client ^(port 5199^)...
start "Emu Client" /min cmd /k "cd /d "%~dp0" && pnpm --filter @emu/client dev"

echo Waiting for the app to come up...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 60;$i++){ try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('localhost',5199); $c.Close(); $ok=$true; break } catch { Start-Sleep -Milliseconds 1000 } }; exit [int](-not $ok)"
if errorlevel 1 (
  echo [ERROR] App did not start within 60 seconds. Check the Emu Server / Emu Client windows.
  pause
  exit /b 1
)

echo Opening http://localhost:5199  ^(logins: admin/admin, manager/manager, clerk/clerk^)
start http://localhost:5199
exit /b 0
