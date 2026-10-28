#!/bin/bash
# ============================================================
#  阿里云服务器 · 就地更新服务端（不重新装环境、不清数据）
#
#  用法：
#    1) 把新的 ddz.zip 传到服务器 /root 目录下
#    2) bash /root/update-server.sh
#
#  它会：自动找新代码 → 备份数据 → 覆盖 server/shared/public
#        → 保留 data（账号/战绩/聊天/金币）→ 重启服务 → 自检
# ============================================================
set -o pipefail
APP_DIR="/opt/ddz"
SERVICE="ddz"
PORT="$(systemctl show -p Environment "$SERVICE" 2>/dev/null | grep -o 'PORT=[0-9]*' | cut -d= -f2)"
PORT="${PORT:-8080}"

log() { echo ""; echo "### $*"; }
die() { echo ""; echo "✘ $*"; exit 1; }

echo "======================================"
echo " 斗地主服务端 · 就地更新"
echo " 安装目录: $APP_DIR   端口: $PORT"
echo "======================================"

# ---------- 1. 找到新代码 ----------
log "1/5 定位新代码"
SRC=""
for c in /root/ddz-new/ddz /root/ddz-new /root/ddz /opt/ddz-new/ddz; do
  [ -f "$c/server/server.js" ] && { SRC="$c"; break; }
done
if [ -z "$SRC" ] && [ -f /root/ddz.zip ]; then
  rm -rf /root/ddz-new; mkdir -p /root/ddz-new
  unzip -q /root/ddz.zip -d /root/ddz-new && SRC="/root/ddz-new/ddz"
fi
[ -n "$SRC" ] || die "没找到新代码。
请先把 ddz.zip 上传到 /root，或解压到 /root/ddz-new/ddz"
echo "✔ 新代码: $SRC"

# ---------- 2. 备份 ----------
log "2/5 备份现有数据与程序"
TS=$(date +%m%d_%H%M)
mkdir -p /root/ddz-backup
if [ -d "$APP_DIR/data" ]; then
  tar -czf "/root/ddz-backup/data_$TS.tar.gz" -C "$APP_DIR" data 2>/dev/null \
    && echo "✔ 数据已备份: /root/ddz-backup/data_$TS.tar.gz"
fi
[ -d "$APP_DIR/public" ] && cp -r "$APP_DIR/public" "/root/ddz-backup/public_$TS" 2>/dev/null && echo "✔ 旧前端已备份"
cp "$APP_DIR/server/server.js" "/root/ddz-backup/server_$TS.js" 2>/dev/null && echo "✔ 旧服务端已备份"

# ---------- 3. 覆盖文件（保留 data） ----------
log "3/5 更新文件"
mkdir -p "$APP_DIR/data"
for d in server shared public; do
  if [ -d "$SRC/$d" ]; then
    rm -rf "$APP_DIR/$d"
    cp -r "$SRC/$d" "$APP_DIR"/ && echo "✔ $d 已更新"
  fi
done
# 依赖优先用内置离线包
if [ -d "$SRC/server/lib/node_modules/ws" ] && [ ! -d "$APP_DIR/server/node_modules/ws" ]; then
  mkdir -p "$APP_DIR/server/node_modules"
  cp -r "$SRC/server/lib/node_modules/ws" "$APP_DIR/server/node_modules/" 2>/dev/null
  echo "✔ 依赖 ws 已就位（离线）"
fi

# ---------- 4. 重启 ----------
log "4/5 重启服务"
systemctl restart "$SERVICE" 2>/dev/null || {
  echo "  systemctl 不可用，改用直接启动"
  pkill -f "$APP_DIR/server/server.js" 2>/dev/null
  sleep 1
  cd "$APP_DIR/server" && PORT="$PORT" nohup node server.js > /tmp/ddz.log 2>&1 &
}
sleep 2.5

# ---------- 5. 自检 ----------
log "5/5 自检"
# 公网 IP：优先阿里云元数据（国内最稳），再试公共接口
get_ip() {
  v=$(curl -s -m 3 http://100.100.100.200/latest/meta-data/public-ipv4 2>/dev/null | tr -d ' 
')
  if echo "$v" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then echo "$v"; return; fi
  for svc in myip.ipip.net icanhazip.com api.ipify.org ifconfig.me ip.sb; do
    v=$(curl -s -m 3 "$svc" 2>/dev/null | tr -d ' 
')
    if echo "$v" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then echo "$v"; return; fi
  done
  echo ""
}
IP=$(get_ip)
[ -z "$IP" ] && IP="服务器公网IP"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/")
echo "本地访问 http://127.0.0.1:$PORT → $CODE"
[ "$CODE" = "200" ] && echo "✔ 服务正常" || { echo "✘ 服务未起来，看日志：journalctl -u $SERVICE -n 50"; exit 1; }

echo ""
echo "======================================"
echo " 服务端更新完成 🎉"
echo " 地址: http://$IP:$PORT"
echo " 数据: 已保留（备份在 /root/ddz-backup）"
echo "--------------------------------------"
echo " 下一步（如需重新打包 APK）："
echo "   bash $SRC/build-apk-server.sh http://$IP:$PORT PP斗地主"
echo "   cp /root/ddz.apk $APP_DIR/public/ddz.apk"
echo "   手机浏览器打开 http://$IP:$PORT/ddz.apk 下载安装"
echo "======================================"
