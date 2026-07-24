@echo off
chcp 65001 >nul
title MyAnimeDock
cd /d "%~dp0"

:MENU
cls
echo ========================================
echo   MyAnimeDock - 启动选单
echo ========================================
echo.
echo  1.  开发模式            (后端 + Vite HMR)
echo  2.  构建 NSIS 安装包
echo  3.  构建 MSI 安装包
echo  4.  构建 MSI + NSIS
echo.
echo  Q.  退出
echo ========================================
echo.

set /p choice="选择 (1-4, Q): "

if "%choice%"=="1" goto DEV
if "%choice%"=="2" goto BUILD_NSIS
if "%choice%"=="3" goto BUILD_MSI
if "%choice%"=="4" goto BUILD_BOTH
if /i "%choice%"=="Q" goto EOF

echo.
echo 无效输入，请重新选择
timeout /t 2 /nobreak >nul
goto MENU

:DEV
cls
echo ========================================
echo  开发模式
echo ========================================
echo.
echo  后端: http://localhost:3457
echo  前端: http://localhost:3456
echo.
echo  Ctrl+C 停止所有服务
echo ========================================
echo.
npm run dev
echo.
echo 开发服务器已停止。
pause
goto MENU

:BUILD_NSIS
cls
echo ========================================
echo  构建 NSIS 安装包
echo ========================================
echo.
echo  顺序: build:frontend ^> build:server ^> tauri build --bundles nsis
echo  输出: src-tauri/target/release/bundle/nsis/
echo.
echo  注意: 需要 Rust 工具链，耗时约 5-10 分钟
echo ========================================
echo.
echo 按任意键开始构建，或关闭窗口取消...
pause >nul

call npm run build:nsis

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo  构建成功！
    echo ========================================
    if exist "src-tauri\target\release\bundle\nsis\" (
        start "" "src-tauri\target\release\bundle\nsis\"
    )
) else (
    echo.
    echo 构建失败 (错误码: %errorlevel%)
)
echo.
pause
goto MENU

:BUILD_MSI
cls
echo ========================================
echo  构建 MSI 安装包
echo ========================================
echo.
echo  顺序: build:frontend ^> build:server ^> tauri build --bundles msi
echo  输出: src-tauri/target/release/bundle/msi/
echo.
echo  注意: 需要 Rust 工具链，耗时约 5-10 分钟
echo ========================================
echo.
echo 按任意键开始构建，或关闭窗口取消...
pause >nul

call npm run build:msi

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo  构建成功！
    echo ========================================
    if exist "src-tauri\target\release\bundle\msi\" (
        start "" "src-tauri\target\release\bundle\msi\"
    )
) else (
    echo.
    echo 构建失败 (错误码: %errorlevel%)
)
echo.
pause
goto MENU

:BUILD_BOTH
cls
echo ========================================
echo  构建 MSI + NSIS 安装包
echo ========================================
echo.
echo  顺序: build:frontend ^> build:server ^> tauri build --bundles msi nsis
echo  输出: src-tauri/target/release/bundle/{msi,nsis}/
echo.
echo  注意: 需要 Rust 工具链，耗时约 10-15 分钟
echo ========================================
echo.
echo 按任意键开始构建，或关闭窗口取消...
pause >nul

call npm run build

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo  构建成功！
    echo ========================================
    if exist "src-tauri\target\release\bundle\nsis\" (
        start "" "src-tauri\target\release\bundle\nsis\"
    )
    if exist "src-tauri\target\release\bundle\msi\" (
        start "" "src-tauri\target\release\bundle\msi\"
    )
) else (
    echo.
    echo 构建失败 (错误码: %errorlevel%)
)
echo.
pause
goto MENU

:EOF
