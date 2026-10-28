#!/bin/bash
# 在服务器上执行：同步改名后的前端 + 重新编译 APK
set -e
DST=/opt/ddz/public
SRC=/root/ddz/public
if [ -d "$DST" ] && [ -f "$SRC/index.html" ]; then
  cp "$SRC/index.html" "$DST/index.html"
  echo "✔ 前端标题已同步到 $DST"
  systemctl restart ddz 2>/dev/null || true
  echo "✔ 服务已重启"
else
  echo "未找到 $DST 或 $SRC/index.html，跳过前端同步"
fi
cd /root/ddz && chmod +x build-apk-server.sh
bash build-apk-server.sh "${1:-http://101.201.106.149:8080}" "${2:-PP斗地主}"
