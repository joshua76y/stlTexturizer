@echo off
title BumpMesh - 置换纹理工具
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════╗
echo  ║   BumpMesh · 焦糖铁观音@2026     ║
echo  ║   3D 模型置换纹理工具            ║
echo  ╚══════════════════════════════════╝
echo.

:: 尝试 Python 3
set PYTHON=
where python >nul 2>&1
if %errorlevel%==0 (
    python --version 2>&1 | find "3." >nul
    if %errorlevel%==0 set PYTHON=python
)
if "%PYTHON%"=="" (
    where py >nul 2>&1
    if %errorlevel%==0 (
        py --version 2>&1 | find "3." >nul
        if %errorlevel%==0 set PYTHON=py
    )
)
if "%PYTHON%"=="" (
    where python3 >nul 2>&1
    if %errorlevel%==0 set PYTHON=python3
)

if "%PYTHON%"=="" (
    echo  [错误] 未找到 Python 3，请先安装：
    echo  https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

echo  [信息] 使用 %PYTHON%
echo  [信息] 正在启动本地服务器...
echo.
echo  请在浏览器中打开：http://localhost:8080
echo  按 Ctrl+C 停止服务器
echo.

:: 打开浏览器
start http://localhost:8080

:: 启动服务器
%PYTHON% -m http.server 8080

pause
