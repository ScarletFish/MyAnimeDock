@echo off
title MyAnimeDock
cd /d "%~dp0"

:MENU
cls
echo ========================================
echo   MyAnimeDock - Launcher
echo ========================================
echo.
echo  1.  Dev Mode           (server + Vite HMR)
echo  2.  Build NSIS Installer
echo  3.  Build MSI Installer
echo  4.  Build MSI + NSIS
echo  5.  Tauri Dev Window   (server + Vite + Tauri)
echo.
echo  Q.  Quit
echo ========================================
echo.

set /p choice="Choice (1-5, Q): "

if "%choice%"=="1" goto DEV
if "%choice%"=="2" goto BUILD_NSIS
if "%choice%"=="3" goto BUILD_MSI
if "%choice%"=="4" goto BUILD_BOTH
if "%choice%"=="5" goto TAURI_DEV
if /i "%choice%"=="Q" goto EOF

echo.
echo Invalid choice
timeout /t 2 /nobreak >nul
goto MENU

:DEV
cls
echo ========================================
echo   Dev Mode
echo ========================================
echo.
echo  Backend:  http://localhost:3457
echo  Frontend: http://localhost:3456
echo.
echo  Press Ctrl+C to stop all services
echo ========================================
echo.
npm run dev
echo.
echo Dev server stopped.
pause
goto MENU

:TAURI_DEV
cls
echo ========================================
echo   Tauri Dev Window
echo ========================================
echo.
echo  Backend:  http://localhost:3457
echo  Frontend: http://localhost:3456
echo  Tauri:    Native window (auto-launched)
echo.
echo  Press Ctrl+C to stop all services
echo ========================================
echo.
npm run dev:tauri
echo.
echo Tauri dev stopped.
pause
goto MENU

:BUILD_NSIS
cls
echo ========================================
echo   Build NSIS Installer
echo ========================================
echo.
echo  Order: build:frontend ^> build:server ^> tauri build --bundles nsis
echo  Output: src-tauri/target/release/bundle/nsis/
echo.
echo  Requires Rust toolchain, ~5-10 min
echo ========================================
echo.
echo Press any key to start build, or close window to cancel...
pause >nul

call npm run build:nsis

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo  Build successful!
    echo ========================================
    if exist "src-tauri\target\release\bundle\nsis\" (
        start "" "src-tauri\target\release\bundle\nsis\"
    )
) else (
    echo.
    echo Build failed (error code: %errorlevel%)
)
echo.
pause
goto MENU

:BUILD_MSI
cls
echo ========================================
echo   Build MSI Installer
echo ========================================
echo.
echo  Order: build:frontend ^> build:server ^> tauri build --bundles msi
echo  Output: src-tauri/target/release/bundle/msi/
echo.
echo  Requires Rust toolchain, ~5-10 min
echo ========================================
echo.
echo Press any key to start build, or close window to cancel...
pause >nul

call npm run build:msi

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo  Build successful!
    echo ========================================
    if exist "src-tauri\target\release\bundle\msi\" (
        start "" "src-tauri\target\release\bundle\msi\"
    )
) else (
    echo.
    echo Build failed (error code: %errorlevel%)
)
echo.
pause
goto MENU

:BUILD_BOTH
cls
echo ========================================
echo   Build MSI + NSIS
echo ========================================
echo.
echo  Order: build:frontend ^> build:server ^> tauri build --bundles msi nsis
echo  Output: src-tauri/target/release/bundle/{msi,nsis}/
echo.
echo  Requires Rust toolchain, ~10-15 min
echo ========================================
echo.
echo Press any key to start build, or close window to cancel...
pause >nul

call npm run build

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo  Build successful!
    echo ========================================
    if exist "src-tauri\target\release\bundle\nsis\" (
        start "" "src-tauri\target\release\bundle\nsis\"
    )
    if exist "src-tauri\target\release\bundle\msi\" (
        start "" "src-tauri\target\release\bundle\msi\"
    )
) else (
    echo.
    echo Build failed (error code: %errorlevel%)
)
echo.
pause
goto MENU

:EOF
