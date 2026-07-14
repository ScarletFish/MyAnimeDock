@echo off
setlocal enabledelayedexpansion
title MyAnimeDock Launcher
pushd "%~dp0"

:MENU
cls
echo +------------------------------------------+
echo :            MyAnimeDock                    :
echo +------------------------------------------+
echo :
echo :  [1] Tauri Dev One-click   (server + Tauri)
echo :  [2] Dev Server Only       (browser test)
echo :  [3] Build NSIS Installer
echo :  [C] Clean Cache
echo :  [Q] Quit
echo :
echo +------------------------------------------+
echo.
set /p "choice=Select: "

if /i "%choice%"=="1" goto DEV_ALL
if /i "%choice%"=="2" goto DEV_SERVER
if /i "%choice%"=="3" goto BUILD_NSIS
if /i "%choice%"=="C" goto CLEAN
if /i "%choice%"=="Q" goto EXIT
goto MENU

:DEV_ALL
cls
echo --- Tauri Dev One-click ---
echo.
echo Starting server + Tauri in current window...
echo Press Ctrl+C to stop both
echo.
call npm run dev
echo.
echo [Done]
pause
goto MENU

:DEV_SERVER
cls
echo --- Dev Server Only ---
echo.
echo Listening at http://localhost:3456
echo Press Ctrl+C to stop
echo.
call npm run dev:server:watch
echo.
pause
goto MENU

:BUILD_NSIS
cls
echo --- Build NSIS Installer ---
echo.
echo 1. pkg sidecar
echo 2. Tauri build (NSIS)
echo.
call npm run build:nsis
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] Build error (code: %ERRORLEVEL%)
    pause
    goto MENU
)
echo.
echo [Done] NSIS installer built successfully
set "DIR=%~dp0src-tauri\target\release\bundle\nsis"
if exist "!DIR!" start "" "!DIR!"
pause
goto MENU

:CLEAN
cls
echo --- Clean Cache ---
echo.
echo Will delete:
echo   - src-tauri\target\        (Rust cache)
echo   - src-tauri\sidecar-modules\
echo   - server\node_modules\.cache\
echo.
set "confirm="
set /p "confirm=Confirm cleanup? (y/N): "
if /i not "!confirm!"=="y" goto MENU

echo Deleting src-tauri\target ...
if exist "src-tauri\target" (
    powershell -NoProfile -Command "Remove-Item -LiteralPath 'src-tauri\target' -Recurse -Force -ErrorAction SilentlyContinue" >nul 2>&1
    if exist "src-tauri\target" (echo  [WARN] some files could not be deleted) else (echo  [DELETED])
) else (echo  [SKIP])

echo Deleting src-tauri\sidecar-modules ...
if exist "src-tauri\sidecar-modules" (
    rd /s /q "src-tauri\sidecar-modules" 2>nul
    if exist "src-tauri\sidecar-modules" (echo  [WARN] some files could not be deleted) else (echo  [DELETED])
) else (echo  [SKIP])

echo Deleting server\node_modules\.cache ...
if exist "server\node_modules\.cache" (
    rd /s /q "server\node_modules\.cache" 2>nul
    if exist "server\node_modules\.cache" (echo  [WARN] some files could not be deleted) else (echo  [DELETED])
) else (echo  [SKIP])

echo.
echo Cleanup complete
pause
goto MENU

:EXIT
popd
exit /b 0
