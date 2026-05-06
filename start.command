#!/usr/bin/env bash
# STL质感生成器 - 3D 模型置换纹理工具
# 双击此文件即可启动（macOS）

cd "$(dirname "$0")"

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║     STL质感生成器                ║"
echo "  ║     3D 模型置换纹理工具           ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# ── 寻找 Python 3 ──
PYTHON=""
if command -v python3 &>/dev/null; then
    PYTHON="python3"
elif command -v python &>/dev/null; then
    # 确认是 Python 3 而非 Python 2
    ver=$(python --version 2>&1)
    if [[ "$ver" == Python\ 3* ]]; then
        PYTHON="python"
    fi
fi

if [ -z "$PYTHON" ]; then
    echo "  [错误] 未找到 Python 3，请先安装："
    echo "          https://www.python.org/downloads/"
    echo ""
    echo "  按 Enter 键退出..."
    read -r
    exit 1
fi

echo "  [信息] 使用 $PYTHON"

# ── 先启动服务器（后台运行）──
echo "  [信息] 正在启动本地服务器..."
$PYTHON serve.py &
SERVER_PID=$!

# ── 等服务器就绪 ──
sleep 2

# ── 再打开浏览器 ──
echo "  [信息] 正在打开浏览器..."
echo ""
open http://localhost:8080

echo "  服务器运行中 (PID: $SERVER_PID)"
echo "  关闭此窗口或按 Ctrl+C 停止服务器"
echo ""

# 捕获 Ctrl+C 信号，优雅停止服务器
trap "kill $SERVER_PID 2>/dev/null; echo ''; echo '  服务器已停止'; exit 0" INT TERM

# 等待服务器进程结束
wait $SERVER_PID 2>/dev/null
