@echo off
title STL质感生成器
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════╗
echo  ║     STL质感生成器                ║
echo  ║     3D 模型置换纹理工具           ║
echo  ╚══════════════════════════════════╝
echo.

REM ── 寻找 Python 3（优先 py 启动器）──
set PYTHON=
py -3 --version >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON=py -3
    goto :PYFOUND
)

python --version >nul 2>&1 && python --version 2>&1 | findstr /b /c:"Python 3" >nul
if errorlevel 1 goto :NOPYTHON
set PYTHON=python

:PYFOUND
echo  [信息] 使用 %PYTHON%

REM ── 启动 HTTP 服务器（新窗口）──
echo  [信息] 正在启动本地服务器...
echo.
start "STL质感生成器 - 服务器" %PYTHON% -m http.server 8080

REM ── 等待服务器就绪 ──
echo  正在等待服务器就绪...
ping -n 3 127.0.0.1 >nul

REM ── 打开浏览器 ──
echo  [信息] 正在打开浏览器...
start http://localhost:8080
echo.
echo  服务器正在 "STL质感生成器 - 服务器" 窗口中运行。
echo  关闭该窗口即可停止服务器。
echo.
pause
exit /b 0

:NOPYTHON
echo  [错误] 未找到 Python 3，请先安装：
echo  https://www.python.org/downloads/
echo.
pause
exit /b 1
