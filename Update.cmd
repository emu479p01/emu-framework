@echo off
title EmuFramework Update
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-framework.ps1" %*
if errorlevel 1 pause
