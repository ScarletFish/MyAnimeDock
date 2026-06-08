@echo off
cd /d "%~dp0"
echo Starting MyAnimeDocker...
echo.
echo Starting server at http://localhost:3456
echo Press Ctrl+C to stop.
echo.
node server.js
