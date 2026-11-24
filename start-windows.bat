@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 LTS: https://nodejs.org/
  pause
  exit /b 1
)
node editor-integration\scripts\start-local.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
