@echo off
cd /d "%~dp0"

echo Stopping anything already listening on 3000 and 4200...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr /C:":3000 " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr /C:":4200 " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo Starting Multizoo backend and frontend...

REM Both the Nest backend and Next.js frontend default to port 3000 when
REM PORT isn't set, so each one is pinned explicitly here to avoid a clash.
start "Multizoo Backend (3000)" cmd /k "set PORT=3000 && npx nx serve api"
start "Multizoo Frontend (4200)" cmd /k "set PORT=4200 && npx nx dev frontend"

echo Backend:  http://localhost:3000/api/v1
echo Backend docs: http://localhost:3000/api/v1/docs
echo Frontend: http://localhost:4200
