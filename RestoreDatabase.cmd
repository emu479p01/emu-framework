@echo off
title EmuFramework Database Restore
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restore-database.ps1" -BackupPath "%~1"
if errorlevel 1 pause
