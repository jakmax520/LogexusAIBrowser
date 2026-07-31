#!/bin/bash
# Logexus AI Browser — Native Messaging Host 注册脚本 (macOS)
# 用法: ./install.sh [扩展ID]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/host.js"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/com.logexus.browser.host.json"

# 扩展 ID — 从参数或使用默认值
EXTENSION_ID="${1:-oecbnmfnnfpkldmahkbgannanaocgead}"

echo "=== Logexus Native Messaging Host 安装 (macOS) ==="
echo "Host 路径: $HOST_PATH"
echo "扩展 ID:   $EXTENSION_ID"
echo ""

# 1. 确保 host.js 有 shebang + 可执行权限
if ! head -1 "$HOST_PATH" | grep -q "node"; then
  echo "❌ host.js 缺少 shebang (#!/usr/bin/env node)"
  exit 1
fi
chmod +x "$HOST_PATH"
echo "✓ host.js 可执行权限已设置"

# 2. 确认 Node.js 可用
if ! command -v node &>/dev/null; then
  echo "❌ Node.js 未安装，请先安装 Node.js"
  exit 1
fi
echo "✓ Node.js: $(node --version)"

# 3. 生成 Chrome NM manifest
mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_PATH" << EOF
{
    "name": "com.logexus.browser.host",
    "description": "Logexus AI Browser Native Messaging Host",
    "path": "$HOST_PATH",
    "type": "stdio",
    "allowed_origins": [
        "chrome-extension://${EXTENSION_ID}/"
    ]
}
EOF
echo "✓ Manifest 已写入: $MANIFEST_PATH"

# 4. 验证
echo ""
echo "=== 安装完成 ==="
echo "请重启 Chrome 使配置生效。"
echo ""
echo "验证方式："
echo "  1. 打开 chrome://extensions"
echo "  2. 找到 Logexus AI Browser 扩展"
echo "  3. 查看 Service Worker 日志"
echo "  4. 应看到 '[SW] Transport: Native Messaging (auto-launched)'"
