@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Create the .venv and install requirements.txt first. See README.md.
  exit /b 1
)
".venv\Scripts\python.exe" -m uvicorn backend.api:app --host 127.0.0.1 --port 8011 --no-access-log
