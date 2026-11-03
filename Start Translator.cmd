@echo off
setlocal
cd /d "%~dp0"
set "TRANSLATOR_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "TRANSLATOR_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not "%TRANSLATOR_NODE%"=="node" if not exist "%TRANSLATOR_NODE%" (
  echo Node.js is required. Install Node.js, then run this launcher again.
  pause
  exit /b 1
)
if not exist "node_modules\@huggingface\transformers\package.json" (
  echo Install app dependencies first: npm ci
  pause
  exit /b 1
)
where codex >nul 2>nul
if errorlevel 1 (
  for /d %%D in ("%LOCALAPPDATA%\OpenAI\Codex\bin\*") do if exist "%%D\codex.exe" set "CODEX_BIN=%%D\codex.exe"
)
start "" "http://127.0.0.1:8765"
"%TRANSLATOR_NODE%" server.mjs
pause
