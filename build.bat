@echo off
cd /d "%~dp0"
echo ============================================
echo   MyAnimeDocker - Build Script
echo ============================================
echo.

:: Check pkg is installed
where pkg >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pkg is not installed. Installing globally...
    call npm install -g pkg
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install pkg. Please run: npm install -g pkg
        pause
        exit /b 1
    )
)

:: Clean previous build
if exist dist (
    echo Cleaning previous build...
    rmdir /s /q dist
)

:: Build with pkg
echo.
echo Building anime-manager.exe with pkg...
call pkg . --target node18-win-x64 --output dist/anime-manager.exe
if %errorlevel% neq 0 (
    echo [ERROR] pkg build failed.
    pause
    exit /b 1
)

:: Copy sharp native modules
echo.
echo Copying sharp native modules...
if exist node_modules\sharp (
    xcopy /e /i /y node_modules\sharp dist\node_modules\sharp\
)
if exist node_modules\@img (
    xcopy /e /i /y node_modules\@img dist\node_modules\@img\
)

:: Create covers directory
if not exist dist\covers mkdir dist\covers

:: Create default config
if not exist dist\config.json (
    echo {"mediaDir":"","playerMode":"system","mpvPath":"mpv"} > dist\config.json
    echo Created default config.json
)

echo.
echo ============================================
echo   Build complete!
echo   Output: dist\anime-manager.exe
echo.
echo   To run: copy the entire dist folder and
echo   double-click anime-manager.exe
echo ============================================
pause
