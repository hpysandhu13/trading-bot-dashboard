@echo off
setlocal

if "%~1"=="" (
  echo Usage: update.bat "commit message"
  exit /b 1
)

set "MSG=%~1"

echo [1/3] Staging changes...
git add .
if errorlevel 1 (
  echo Failed during git add.
  exit /b 1
)

echo [2/3] Creating commit...
git commit -m "%MSG%"
if errorlevel 1 (
  echo Commit failed. If there are no changes, this is expected.
  exit /b 1
)

echo [3/3] Pushing to origin/main...
git push origin main
if errorlevel 1 (
  echo Push failed.
  exit /b 1
)

echo Done. Changes pushed successfully.
exit /b 0
