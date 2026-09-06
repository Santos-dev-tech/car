@echo off
title MotoKE - vehicle sales and asset finance platform
cd /d "%~dp0"

set NODE_EXE=C:\Users\ADMIN\nodejs-portable\node-v22.16.0-win-x64\node.exe
if not exist "%NODE_EXE%" (
  where node >nul 2>nul && set NODE_EXE=node
)
if not exist "%NODE_EXE%" if not "%NODE_EXE%"=="node" (
  echo.
  echo   Node 22.5 or newer is required and was not found.
  echo   Expected it at C:\Users\ADMIN\nodejs-portable\node-v22.16.0-win-x64\node.exe
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting MotoKE...
echo.
start "" http://localhost:4000/
"%NODE_EXE%" --no-warnings server.js --port 4000
pause
