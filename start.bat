@echo off
title STL质感生成器 - 置换纹理工具
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════╗
echo  ║     STL质感生成器                ║
echo  ║     3D 模型置换纹理工具           ║
echo  ╚══════════════════════════════════╝
echo.

:: ── 寻找 Python 3 ──
set PYTHON=
where python >nul 2>&1
if %errorlevel%==0 (
    python --version 2>&1 | find "3." >nul
    if %errorlevel%==0 set PYTHON=python
)
if "%PYTHON%"=="" (
    where python3 >nul 2>&1
    if %errorlevel%==0 set PYTHON=python3
)
if "%PYTHON%"=="" (
    where py >nul 2>&1
    if %errorlevel%==0 (
        py --version 2>&1 | find "3." >nul
        if %errorlevel%==0 set PYTHON=py
    )
)

if "%PYTHON%"=="" (
    echo  [错误] 未找到 Python 3，请先安装：
    echo  https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

echo  [信息] 使用 %PYTHON%

:: ── 先启动服务器（新的最小化窗口）──
echo  [信息] 正在启动本地服务器...
start "STL质感生成器 - 服务器" /MIN %PYTHON% serve.py

:: ── 等服务器就绪 ──
timeout /t 2 /nobreak >nul

:: ── 再打开浏览器 ──
echo  [信息] 正在打开浏览器...
start http://localhost:8080
echo.
echo  服务器已在后台运行，关闭此窗口不会影响服务器。
echo  要停止服务器，请关闭 "STL质感生成器 - 服务器" 窗口。
echo.
pause
