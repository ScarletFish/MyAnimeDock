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
echo :   [1] Start dev server (nodemon)                         :
echo :   [2] Build MSI installer                                :
echo :   [3] Build NSIS installer                               :
echo :   [4] Build MSI + NSIS (full build)                      :
echo :   [5] Prisma Studio (database)                           :
echo :   [6] Clean build cache                                  :
echo :   [7] Exit                                               :
echo :                                                          :
echo +----------------------------------------------------------+
echo.
set "choice="
set /p choice="Select [1-7]: "
if "%choice%"=="1" goto DEV
if "%choice%"=="2" goto BUILD_MSI
if "%choice%"=="3" goto BUILD_NSIS
if "%choice%"=="4" goto BUILD_ALL
if "%choice%"=="5" goto PRISMA
if "%choice%"=="6" goto CLEAN
if "%choice%"=="7" goto EXIT
goto MENU

:DEV
cls
echo --- Start dev server ---
echo.
echo Killing any existing node processes...
taskkill /f /im node.exe 2>nul
echo Press Ctrl+C to stop server.
echo.
call npm run dev:server:watch
echo.
pause
goto MENU

:BUILD_MSI
cls
echo --- Build MSI installer ---
echo.
call npm run build:msi
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] MSI build failed (code: %ERRORLEVEL%)
    pause
    goto MENU
)
echo.
echo [DONE] MSI installer built successfully
echo.
start "" "src-tauri\target\release\bundle\msi"
pause
goto MENU

:BUILD_NSIS
cls
echo --- Build NSIS installer ---
echo.
echo Note: first run may download NSIS toolchain.
echo.
call npm run build:nsis
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] NSIS build failed (code: %ERRORLEVEL%)
    pause
    goto MENU
)
echo.
echo [DONE] NSIS installer built successfully
echo.
start "" "src-tauri\target\release\bundle\nsis"
pause
goto MENU

:BUILD_ALL
cls
echo --- Build MSI + NSIS installers ---
echo.
echo Full build: pkg sidecar + copy-sidecar-deps + Rust + bundles
echo.
call npm run build
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Full build failed (code: %ERRORLEVEL%)
    pause
    goto MENU
)
echo.
echo [DONE] Installers built successfully
echo.
echo Opening MSI folder...
start "" "src-tauri\target\release\bundle\msi"
echo Opening NSIS folder...
start "" "src-tauri\target\release\bundle\nsis"
pause
goto MENU

:PRISMA
cls
echo --- Start Prisma Studio ---
echo.
call npm run prisma:studio
echo.
pause
goto MENU

:CLEAN
cls
echo --- Clean build cache ---
echo.
echo Will delete:
echo   - src-tauri\target\     (Rust cache, ~5GB)
echo   - src-tauri\sidecar-modules\  (copied modules)
echo   - server\node_modules\.cache\
echo.
set /p confirm="Confirm cleanup? (y/N): "
if /i not "%confirm%"=="y" goto MENU

if exist "src-tauri\target" (
    rmdir /s /q "src-tauri\target" 2>nul
    echo  [DELETED] src-tauri\target
) else (
    echo  [SKIP]   src-tauri\target (not found)
)

if exist "src-tauri\sidecar-modules" (
    rmdir /s /q "src-tauri\sidecar-modules" 2>nul
    echo  [DELETED] src-tauri\sidecar-modules
) else (
    echo  [SKIP]   src-tauri\sidecar-modules (not found)
)

if exist "server\node_modules\.cache" (
    rmdir /s /q "server\node_modules\.cache" 2>nul
    echo  [DELETED] server\node_modules\.cache
) else (
    echo  [SKIP]   server\node_modules\.cache (not found)
)

echo.
echo Done. Next build will recompile Rust.
echo.
pause
goto MENU

:EXIT
popd
exit /b 0
