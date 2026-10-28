#!/bin/bash
# ============================================================
#  斗地主 · 完整更新（改名 + 重新编译 APK）
#  在服务器 /root/ddz 目录下执行
#  用法： sudo bash do-all.sh http://101.201.106.149:8080
# ============================================================
set -o pipefail
SERVER="${1:-http://101.201.106.149:8080}"
SERVER="${SERVER%/}"
NAME="${2:-PP斗地主}"

echo "======================================"
echo " 完整更新"
echo " 服务器: $SERVER"
echo " 名称:   $NAME"
echo "======================================"

# ---------- 1. 同步前端标题 ----------
echo ""
echo "### 1/2 同步网页标题"
DST=/opt/ddz/public
SRC=/root/ddz/public
if [ -d "$DST" ] && [ -f "$SRC/index.html" ]; then
  cp "$SRC/index.html" "$DST/index.html"
  echo "✔ 已同步到 $DST/index.html"
  grep -o "<title>[^<]*</title>" "$DST/index.html" || true
  systemctl restart ddz 2>/dev/null && echo "✔ 服务已重启" || echo "（服务未运行，跳过重启）"
else
  echo "⚠ 没找到 $DST 或 $SRC/index.html，跳过前端同步"
  echo "  如果你还没部署过服务端，请先跑 deploy/deploy.sh"
fi

# ---------- 2. 编译 APK ----------
echo ""
echo "### 2/2 编译 APK（首次约 10~20 分钟）"
cd /root/ddz
chmod +x build-apk-server.sh
bash build-apk-server.sh "$SERVER" "$NAME"
