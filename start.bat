@echo off
title MyAnimeDock Dev Server
cd /d "%~dp0"

echo ========================================
echo  MyAnimeDock - 一键启动
echo ========================================
echo.
echo  后端: http://localhost:3457
echo  前端: http://localhost:3456
echo.
echo ========================================
echo.

npm run dev

if %errorlevel% neq 0 (
    echo.
    echo 启动失败 (错误码: %errorlevel%)
    pause
)
