@echo off
cd /d "%~dp0"
echo ========================================
echo   MyAnimeDocker - Server Launcher
echo ========================================
echo.
echo [1] Start server (SQLite + JSON dual-write)
echo [2] Quick test: load data check
echo [3] Quick test: verify Prisma connection
echo [4] Tauri dev mode (requires server running)
echo [5] Build MSI/NSIS installer
echo.
set /p choice="Select (1-5): "

if "%choice%"=="1" goto start
if "%choice%"=="2" goto test
if "%choice%"=="3" goto prisma
if "%choice%"=="4" goto tauri
if "%choice%"=="5" goto build
echo Invalid choice
pause
exit /b

:start
echo Starting server at http://localhost:3456
echo Press Ctrl+C to stop.
echo.
node server\server.js
pause
exit /b

:test
echo Checking SQLite data load...
node -e "const db = require('./server/db'); db.loadData().then(d => { console.log('OK: ' + d.library.length + ' anime, ' + d.memories.length + ' memories, ' + d.playSessions.length + ' sessions'); process.exit(0); }).catch(e => { console.error('FAIL:', e.message); process.exit(1); })"
pause
exit /b

:prisma
echo Verifying Prisma client + DB connection...
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient({ datasources: { db: { url: 'file:./prisma/anime.db' } } }); p.$connect().then(() => console.log('Prisma connection OK')).catch(e => console.error('Prisma FAIL:', e.message)).finally(() => p.$disconnect())"
pause
exit /b

:tauri
echo Starting Tauri dev window...
echo Make sure server is already running in another terminal.
npm run dev:tauri
pause
exit /b

:build
echo Building MSI/NSIS installer...
npm run build
pause
exit /b
