@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Create the .venv and install requirements.txt first. See README.md.
  exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  echo Run npm.cmd ci first. See README.md.
  exit /b 1
)
start "Milwaukee Together API" cmd /k start-backend.cmd
start "Milwaukee Together web" cmd /k start-frontend.cmd
