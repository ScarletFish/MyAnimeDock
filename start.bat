@echo off
setlocal enabledelayedexpansion
title MyAnimeDocker Tool Menu
pushd "%~dp0"

:MENU
cls
echo +----------------------------------------------------------+
echo :                 MyAnimeDocker  Tool Menu                  :
echo +----------------------------------------------------------+
echo :                                                          :
echo : Tier 0 - Rust Type Check (20s)                           :
echo :   [1] Rust type check (cargo check)                      :
echo :                                                          :
echo : Tier 1 - JS/UI Development (instant)                     :
echo :   [2] Start dev server (nodemon watch)                    :
echo :   [3] Start dev server (foreground)                       :
echo :                                                          :
echo : Tier 2 - Rust + Desktop Testing (1min)                   :
echo :   [4] Tauri dev window (server must be running)           :
echo :   [5] Production flow simulation (auto sidecar)           :
echo :   [6] Build release EXE only (fast, no installer)         :
echo :                                                          :
echo : Tier 3 - Production Build (5min)                         :
echo :   [7] Build MSI installer                                 :
echo :   [8] Build NSIS installer                                :
echo :   [9] Build MSI + NSIS (full build)                       :
echo :  [10] Build sidecar only (pkg)                            :
echo :                                                          :
echo : Prisma / Database                                        :
echo :  [P] Prisma Studio                                        :
echo :  [M] Prisma Generate (after schema change)                :
echo :                                                          :
echo : Maintenance                                               :
echo :  [C] Clean build cache (Rust + modules)                   :
echo :  [Q] Exit                                                 :
echo +----------------------------------------------------------+
echo.
set /p "choice=Select [1-10/P/M/C/Q]: "

REM --- Tier 0 ---
if /i "%choice%"=="1" goto CHECK_RUST

REM --- Tier 1 ---
if /i "%choice%"=="2" goto DEV_WATCH
if /i "%choice%"=="3" goto DEV_FG

REM --- Tier 2 ---
if /i "%choice%"=="4" goto DEV_TAURI
if /i "%choice%"=="5" goto DEV_PROD
if /i "%choice%"=="6" goto BUILD_EXE

REM --- Tier 3 ---
if /i "%choice%"=="7" goto BUILD_MSI
if /i "%choice%"=="8" goto BUILD_NSIS
if /i "%choice%"=="9" goto BUILD_ALL
if /i "%choice%"=="10" goto BUILD_SERVER

REM --- Prisma ---
if /i "%choice%"=="P" goto PRISMA_STUDIO
if /i "%choice%"=="M" goto PRISMA_GENERATE

REM --- Maintenance ---
if /i "%choice%"=="C" goto CLEAN
if /i "%choice%"=="Q" goto EXIT

goto MENU


REM ============================================================
REM Tier 0 - Rust Type Check
REM ============================================================
:CHECK_RUST
cls
echo --- Tier 0: Rust Type Check ---
echo.
echo Fast syntax/type verification without full compilation.
echo.
call npm run check:rust
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] Type check found errors (code: %ERRORLEVEL%)
) else (
    echo.
    echo [PASS] Rust type check passed
)
echo.
pause
goto MENU


REM ============================================================
REM Tier 1 - JS/UI Development
REM ============================================================

:DEV_WATCH
cls
echo --- Tier 1: Dev Server (nodemon watch) ---
echo.
echo Listening at http://localhost:3456
echo Press Ctrl+C to stop.
echo.
call npm run dev:server:watch
echo.
pause
goto MENU

:DEV_FG
cls
echo --- Tier 1: Dev Server (foreground) ---
echo.
echo Listening at http://localhost:3456
echo Press Ctrl+C to stop.
echo.
call npm run dev:server
echo.
pause
goto MENU


REM ============================================================
REM Tier 2 - Rust + Desktop Testing
REM ============================================================

:DEV_TAURI
cls
echo --- Tier 2: Tauri Dev Window ---
echo.
echo REQUIRE: Server must be running already (option 2 or 3).
echo.
echo If sidecar starts instead of connecting, edit src-tauri\tauri.conf.json
echo to disable auto-launch in dev mode.
echo.
echo.
call npm run dev:tauri
echo.
pause
goto MENU

:DEV_PROD
cls
echo --- Tier 2: Production Flow Simulation ---
echo.
echo Mimics production startup behavior:
echo   1. Build sidecar (pkg)
echo   2. Start Node.js server in background
echo   3. Launch Tauri dev (connects to already-running server)
echo.
echo Note: Rust compilation (step 3) may take ~1 min first time.
echo       The server will be ready waiting when Tauri window opens.
echo.
call npm run dev:prod
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] Production simulation failed (code: %ERRORLEVEL%)
    pause
    goto MENU
)
echo.
echo [DONE] Production simulation completed
echo.
pause
goto MENU

:BUILD_EXE
cls
echo --- Tier 2: Build Release EXE ---
echo.
echo Fast Tauri release build (EXE only, no MSI/NSIS).
echo Output: src-tauri\target\release\myanimedocker.exe
echo.
call npm run build:exe
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] EXE build failed (code: %ERRORLEVEL%)
) else (
    echo.
    echo [DONE] Release EXE built successfully
    echo.
    set "EXE_DIR=%~dp0src-tauri\target\release"
    if exist "!EXE_DIR!" (
        start "" "!EXE_DIR!"
    )
)
echo.
pause
goto MENU


REM ============================================================
REM Tier 3 - Production Build
REM ============================================================

:BUILD_MSI
cls
echo --- Tier 3: Build MSI Installer ---
echo.
echo pkg sidecar + copy-sidecar-deps + Rust MSI bundle.
echo.
call npm run build:msi
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] MSI build failed (code: %ERRORLEVEL%)
    pause
    goto MENU
)
echo.
echo [DONE] MSI installer built successfully
echo.
pause
set "DIR_MSI=%~dp0src-tauri\target\release\bundle\msi"
if exist "!DIR_MSI!" (
    start "" "!DIR_MSI!"
) else (
    echo [WARN] MSI output folder not found
)
echo.
goto MENU

:BUILD_NSIS
cls
echo --- Tier 3: Build NSIS Installer ---
echo.
echo pkg sidecar + copy-sidecar-deps + Rust NSIS bundle.
echo.
echo Note: first run may download NSIS toolchain.
echo.
call npm run build:nsis
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] NSIS build failed (code: %ERRORLEVEL%)
    pause
    goto MENU
)
echo.
echo [DONE] NSIS installer built successfully
echo.
pause
set "DIR_NSIS=%~dp0src-tauri\target\release\bundle\nsis"
if exist "!DIR_NSIS!" (
    start "" "!DIR_NSIS!"
) else (
    echo [WARN] NSIS output folder not found
)
echo.
goto MENU

:BUILD_ALL
cls
echo --- Tier 3: Full Build (MSI + NSIS) ---
echo.
echo Steps:
echo   1. pkg sidecar
echo   2. copy-sidecar-deps (Prisma engine + ffmpeg)
echo   3. Rust release build
echo   4. MSI + NSIS bundles
echo.
call npm run build
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] Full build failed (code: %ERRORLEVEL%)
    pause
    goto MENU
)
echo.
echo [DONE] Installers built successfully
echo.
pause
set "DIR_BUNDLE=%~dp0src-tauri\target\release\bundle"
if exist "!DIR_BUNDLE!" (
    start "" "!DIR_BUNDLE!"
) else (
    echo [WARN] Bundle output folder not found
)
echo.
goto MENU

:BUILD_SERVER
cls
echo --- Tier 3: Build Sidecar (pkg) ---
echo.
echo Build standalone server executable only.
echo Output: src-tauri\server-x86_64-pc-windows-msvc.exe
echo.
call npm run build:server
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] Sidecar build failed (code: %ERRORLEVEL%)
) else (
    echo.
    echo [DONE] Sidecar built successfully
)
echo.
pause
goto MENU


REM ============================================================
REM Prisma / Database
REM ============================================================

:PRISMA_STUDIO
cls
echo --- Prisma Studio ---
echo.
echo Opens SQLite database browser in your default browser.
echo Close the browser tab or press Ctrl+C in the terminal to stop.
echo.
call npm run prisma:studio
echo.
pause
goto MENU

:PRISMA_GENERATE
cls
echo --- Prisma Generate ---
echo.
echo Regenerates Prisma client after schema change.
echo.
call npm run prisma:generate
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] Prisma generate failed (code: %ERRORLEVEL%)
) else (
    echo.
    echo [DONE] Prisma client regenerated
)
echo.
pause
goto MENU


REM ============================================================
REM Maintenance
REM ============================================================

:CLEAN
cls
echo --- Clean Build Cache ---
echo.
echo Will delete:
echo   - src-tauri\target\          (Rust cache, ~5GB)
echo   - src-tauri\sidecar-modules\ (copied modules)
echo   - server\node_modules\.cache\
echo.
set "confirm="
set /p "confirm=Confirm cleanup? (y/N): "
if /i not "!confirm!"=="y" goto MENU

echo.
echo Deleting src-tauri\target ...
if exist "src-tauri\target" (
    powershell -NoProfile -Command "Remove-Item -LiteralPath 'src-tauri\target' -Recurse -Force -ErrorAction SilentlyContinue" >nul 2>&1
    if exist "src-tauri\target" (
        echo  [WARN] Could not fully delete src-tauri\target (some files in use or permissions)
    ) else (
        echo  [DELETED] src-tauri\target
    )
) else (
    echo  [SKIP] src-tauri\target (not found)
)

echo Deleting src-tauri\sidecar-modules ...
if exist "src-tauri\sidecar-modules" (
    rd /s /q "src-tauri\sidecar-modules" 2>nul
    if exist "src-tauri\sidecar-modules" (
        echo  [WARN] Could not fully delete sidecar-modules
    ) else (
        echo  [DELETED] src-tauri\sidecar-modules
    )
) else (
    echo  [SKIP] src-tauri\sidecar-modules (not found)
)

echo Deleting server\node_modules\.cache ...
if exist "server\node_modules\.cache" (
    rd /s /q "server\node_modules\.cache" 2>nul
    if exist "server\node_modules\.cache" (
        echo  [WARN] Could not delete .cache
    ) else (
        echo  [DELETED] server\node_modules\.cache
    )
) else (
    echo  [SKIP] server\node_modules\.cache (not found)
)

echo.
echo Done. Next build will recompile Rust.
echo.
pause
goto MENU


:EXIT
popd
exit /b 0
