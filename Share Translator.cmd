@echo off
setlocal
cd /d "%~dp0"
set "TRANSLATOR_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "TRANSLATOR_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not "%TRANSLATOR_NODE%"=="node" if not exist "%TRANSLATOR_NODE%" (
  echo Node.js is required. Install Node.js and try again.
  pause
  exit /b 1
)
where codex >nul 2>nul
if errorlevel 1 (
  for /d %%D in ("%LOCALAPPDATA%\OpenAI\Codex\bin\*") do if exist "%%D\codex.exe" set "CODEX_BIN=%%D\codex.exe"
)
where ngrok >nul 2>nul
if errorlevel 1 (
  echo Install ngrok and connect your ngrok account first.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8768"
"%TRANSLATOR_NODE%" share.mjs
pause
