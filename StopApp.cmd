@echo off
title EmuFramework v0.0.0.5 - Stop
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -Stop
