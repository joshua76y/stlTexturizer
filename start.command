#!/usr/bin/env bash
# BumpMesh - 3D 模型置换纹理工具
# 双击此文件即可启动（macOS）

cd "$(dirname "$0")"

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║   BumpMesh · 焦糖铁观音@2026     ║"
echo "  ║   3D 模型置换纹理工具            ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# 尝试寻找 Python 3
PYTHON=""
if command -v python3 &>/dev/null; then
    PYTHON="python3"
elif command -v python &>/dev/null && python --version 2>&1 | grep -q "^Python 3"; then
    PYTHON="python"
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
echo "  [信息] 正在启动本地服务器..."
echo ""
echo "  请在浏览器中打开：http://localhost:8080"
echo "  按 Ctrl+C 停止服务器"
echo ""

# 打开浏览器
open http://localhost:8080

# 启动服务器
$PYTHON -m http.server 8080
