#!/usr/bin/env bash
# ============================================================
#  安装 TURN 中继服务器（coturn）
#
#  为什么需要：语音/视频通话是点对点（P2P）的。双方在同一 WiFi
#  下一般能直连；一旦「一个 WiFi、一个 4G」，运营商的对称型 NAT
#  会让 P2P 打洞失败 —— 表现就是能拨通但没声音 / 黑屏。
#  TURN 的作用是在这种时候充当中转站：媒体流经服务器转发，
#  牺牲一点服务器带宽，换来跨网络也能连通。
#
#  用法（在阿里云服务器上，root 执行）：
#    bash setup-turn.sh
# ============================================================
set -e

CONF_ENV=/etc/ddz/turn.env
TURN_CONF=/etc/turnserver.conf
SERVICE=ddz

echo "======================================"
echo " TURN 中继服务器 安装"
echo "======================================"

if [ "$(id -u)" != "0" ]; then echo "✘ 请用 root 执行（先敲 sudo -i）"; exit 1; fi

# ---- 1. 取得公网 IP ----
echo "→ 获取公网 IP ..."
PUBIP=""
for u in "http://100.100.100.200/latest/meta-data/public-ipv4" \
         "https://api.ipify.org" "https://ifconfig.me/ip" "http://myip.ipip.net"; do
  PUBIP=$(curl -s --max-time 5 "$u" 2>/dev/null | tr -d ' \n\r' | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
  [ -n "$PUBIP" ] && break
done
if [ -z "$PUBIP" ]; then
  read -r -p "自动获取失败，请手动输入本机公网 IP: " PUBIP
fi
[ -z "$PUBIP" ] && { echo "✘ 拿不到公网 IP，无法继续"; exit 1; }
echo "✔ 公网 IP: $PUBIP"

# ---- 2. 安装 coturn ----
echo "→ 安装 coturn ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1 || true
if ! command -v turnserver >/dev/null 2>&1; then
  apt-get install -y -qq coturn >/dev/null 2>&1 || {
    echo "✘ coturn 安装失败，请检查 apt 源"; exit 1; }
fi
echo "✔ coturn 已安装: $(command -v turnserver)"

# ---- 3. 生成密钥 ----
SECRET=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)
[ -z "$SECRET" ] && SECRET="ddzturn$(date +%s)secret"
REALM="$PUBIP"

# ---- 4. 写配置 ----
echo "→ 写 coturn 配置 ..."
if [ -f "$TURN_CONF" ] && ! grep -q "DDZ-MANAGED" "$TURN_CONF"; then
  cp "$TURN_CONF" "${TURN_CONF}.bak.$(date +%s)"
fi

cat > "$TURN_CONF" <<EOF
# DDZ-MANAGED —— 由 setup-turn.sh 生成，重复执行会覆盖
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
external-ip=$PUBIP
realm=$REALM
server-name=ddz-turn

# 临时凭证模式（use-auth-secret）：服务端用同一把密钥签发短期账号，
# 账号本身不会泄露，安全性比写死用户名密码好得多
use-auth-secret
static-auth-secret=$SECRET

# 只做中继，不开放匿名转发，避免服务器被当成免费代理滥用
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.88.99.0-192.88.99.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=198.51.100.0-198.51.100.255
denied-peer-ip=203.0.113.0-203.0.113.255
denied-peer-ip=240.0.0.0-255.255.255.255
no-tlsv1
no-tlsv1_1

# 中继端口范围（媒体流实际用的端口），安全组要一并放行
min-port=49152
max-port=65535

# 限速，避免被滥用拖垮带宽
user-quota=0
total-quota=0
max-bps=0

fingerprint
lt-cred-mech
stale-nonce
no-cli
no-rfc5780
no-stdout-log
log-file=/var/log/turnserver.log
simple-log
EOF
echo "✔ 配置已写入 $TURN_CONF"

# ---- 5. 记下密钥，供 Node 服务签发凭证 ----
mkdir -p /etc/ddz
cat > "$CONF_ENV" <<EOF
TURN_SECRET=$SECRET
TURN_URLS=turn:$PUBIP:3478
EOF
chmod 600 "$CONF_ENV"
echo "✔ 密钥已保存到 $CONF_ENV"

# ---- 6. 放行端口 ----
echo "→ 放行端口 ..."
if command -v iptables >/dev/null 2>&1; then
  for P in 3478 5349; do
    for PROTO in tcp udp; do
      iptables -C INPUT -p $PROTO --dport $P -j ACCEPT 2>/dev/null || \
      iptables -A INPUT -p $PROTO --dport $P -j ACCEPT
    done
  done
  iptables -C INPUT -p udp --dport 49152:65535 -j ACCEPT 2>/dev/null || \
  iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT
  echo "✔ iptables 已放行 3478 / 5349 / 49152-65535"
fi
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 3478/tcp >/dev/null 2>&1 || true
  ufw allow 3478/udp >/dev/null 2>&1 || true
  ufw allow 5349/tcp >/dev/null 2>&1 || true
  ufw allow 49152:65535/udp >/dev/null 2>&1 || true
  echo "✔ ufw 已放行"
fi

# ---- 7. 启动 coturn ----
echo "→ 启动 coturn ..."
# 允许 coturn 开机自启
if [ -f /etc/default/coturn ]; then
  sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true
  echo "TURNSERVER_ENABLED=1" >> /etc/default/coturn
fi
mkdir -p /var/log
touch /var/log/turnserver.log
systemctl daemon-reload
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn 2>/dev/null || turnserver -c "$TURN_CONF" --daemon
sleep 2

if systemctl is-active --quiet coturn 2>/dev/null || pgrep -x turnserver >/dev/null 2>&1; then
  echo "✔ coturn 已运行"
else
  echo "⚠ coturn 未能启动，查看日志：tail -50 /var/log/turnserver.log"
fi

# ---- 8. 让 Node 服务读到密钥并重启 ----
echo "→ 重启斗地主服务以加载 TURN 配置 ..."
if [ -f /etc/systemd/system/${SERVICE}.service ]; then
  # 把 TURN 变量写进 systemd（幂等：先删旧的再加新的）
  sed -i '/^Environment=TURN_/d' /etc/systemd/system/${SERVICE}.service
  sed -i "s|^Environment=PORT=|Environment=TURN_SECRET=$SECRET\nEnvironment=TURN_URLS=turn:$PUBIP:3478\nEnvironment=PORT=|" \
      /etc/systemd/system/${SERVICE}.service
  systemctl daemon-reload
  systemctl restart ${SERVICE}
  sleep 2
  echo "✔ ${SERVICE} 已重启"
else
  echo "⚠ 没找到 ${SERVICE}.service，请先跑一次 deploy.sh"
fi

# ---- 9. 自检 ----
echo ""
echo "======================================"
echo " 安装完成"
echo "======================================"
echo " TURN 地址 : turn:$PUBIP:3478"
echo " 凭证模式  : 临时凭证（use-auth-secret）"
echo ""
echo " ⚠ 还有一步必须手动做（阿里云控制台）："
echo "   安全组放行 TCP+UDP 3478、TCP 5349、UDP 49152-65535"
echo "   不放行的话，外网连不上 TURN，跨网络通话依旧会失败。"
echo ""
echo " 验证接口（返回 relay:true 即生效）："
echo "   curl http://127.0.0.1:8080/api/ice"
echo "======================================"
