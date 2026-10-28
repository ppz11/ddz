#!/bin/bash
# ============================================================
#  斗地主服务端 · 一键部署脚本
#  适用于 Ubuntu / Debian / CentOS / Rocky / AlmaLinux
#  用法： sudo bash deploy.sh [端口号]
# ============================================================
set -e
PORT="${1:-8080}"
APP_DIR="/opt/ddz"
SERVICE="ddz"

echo "======================================"
echo " 斗地主服务端 一键部署"
echo " 端口: $PORT"
echo "======================================"

# ---- 1. 安装 Node ----
install_node() {
  if command -v node >/dev/null 2>&1; then
    V=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$V" -ge 18 ]; then echo "✔ Node 已安装: $(node -v)"; return; fi
  fi
  echo "→ 安装 Node.js 20 ..."
  # 方式A：官方 nodesource（国内可能慢）
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates xz-utils
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null && apt-get install -y -qq nodejs 2>/dev/null || true
  elif command -v yum >/dev/null 2>&1 || command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    (command -v dnf >/dev/null 2>&1 && dnf install -y nodejs) || yum install -y nodejs
  else
    echo "✘ 未能识别系统包管理器，尝试二进制方式"
  fi

  # 方式B：国内镜像二进制兜底（npmmirror，国内速度快）
  if ! (command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/v//' | cut -d. -f1)" -ge 18 ]); then
    echo "→ 改用国内镜像安装 Node 20 ..."
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64|amd64)  NA="x64"   ;;
      aarch64|arm64) NA="arm64" ;;
      *)             NA="x64"   ;;
    esac
    NV="v20.18.0"
    curl -fsSL --connect-timeout 15 \
      "https://registry.npmmirror.com/-/binary/node/${NV}/node-${NV}-linux-${NA}.tar.xz" \
      -o /tmp/node.tar.xz && \
      mkdir -p /usr/local/node && \
      tar -xJf /tmp/node.tar.xz -C /usr/local/node --strip-components=1 && \
      ln -sf /usr/local/node/bin/node /usr/local/bin/node && \
      ln -sf /usr/local/node/bin/npm  /usr/local/bin/npm && \
      ln -sf /usr/local/node/bin/npx  /usr/local/bin/npx
    echo 'export PATH=/usr/local/node/bin:$PATH' > /etc/profile.d/node.sh
    export PATH=/usr/local/node/bin:$PATH
  fi

  if ! (command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/v//' | cut -d. -f1)" -ge 18 ]); then
    echo "✘ Node 安装失败，请检查服务器能否访问外网，然后手动安装 Node.js 18+"
    exit 1
  fi
  echo "✔ Node 安装完成: $(node -v)"
}

# ---- 2. 拷贝文件 ----
copy_files() {
  echo "→ 部署到 $APP_DIR ..."
  mkdir -p "$APP_DIR"
  SRC="$(cd "$(dirname "$0")/.." && pwd)"
  cp -r "$SRC"/server "$SRC"/shared "$SRC"/public "$APP_DIR"/
  mkdir -p "$APP_DIR/data"
  echo "✔ 文件已就位"
}

# ---- 3. 安装依赖 ----
install_deps() {
  echo "→ 安装依赖（ws）..."
  cd "$APP_DIR/server"
  # 优先用项目内置的离线依赖，完全不联网
  if [ -d "$APP_DIR/server/lib/node_modules/ws" ]; then
    mkdir -p "$APP_DIR/server/node_modules"
    cp -r "$APP_DIR/server/lib/node_modules/ws" "$APP_DIR/server/node_modules/" 2>/dev/null
    echo "✔ 已使用内置离线依赖 ws（无需联网）"
    return
  fi
  npm install --omit=dev --no-audit --no-fund 2>/dev/null || npm install ws --no-audit --no-fund 2>/dev/null || true
  if [ ! -d "$APP_DIR/server/node_modules/ws" ]; then
    echo "✘ 依赖 ws 缺失，请手动执行：cd $APP_DIR/server && npm install ws"
    exit 1
  fi
  echo "✔ 依赖就绪"
}

# ---- 4. 配置 systemd ----
setup_service() {
  echo "→ 配置开机自启 ..."
  cat > /etc/systemd/system/${SERVICE}.service <<EOF
[Unit]
Description=DDZ Game Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/server
Environment=PORT=$PORT
ExecStart=$(command -v node) $APP_DIR/server/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable ${SERVICE} >/dev/null 2>&1
  systemctl restart ${SERVICE}
  sleep 2
  systemctl is-active --quiet ${SERVICE} && echo "✔ 服务已启动" || { echo "✘ 启动失败，查看日志：journalctl -u $SERVICE -n 50"; exit 1; }
}

# ---- 5. 防火墙 ----
open_port() {
  echo "→ 放行端口 $PORT ..."
  if command -v ufw >/dev/null 2>&1; then
    ufw allow ${PORT}/tcp >/dev/null 2>&1 || true
  fi
  if command -v firewall-cmd >/dev/null 2>&1; then
    systemctl start firewalld >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-port=${PORT}/tcp >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi
  if command -v iptables >/dev/null 2>&1; then
    iptables -C INPUT -p tcp --dport ${PORT} -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport ${PORT} -j ACCEPT
  fi
  echo "✔ 端口已放行"
}

# ---- 6. 验证 ----
verify() {
  IP=$(curl -s -m 5 ifconfig.me 2>/dev/null || curl -s -m 5 ip.sb 2>/dev/null || echo "本机IP")
  echo ""
  echo "======================================"
  echo " 部署完成 🎉"
  echo " 访问地址: http://$IP:$PORT"
  echo " 健康检查: http://$IP:$PORT/api/health"
  echo "--------------------------------------"
  echo " 常用命令："
  echo "   查看状态: systemctl status $SERVICE"
  echo "   查看日志: journalctl -u $SERVICE -f"
  echo "   重启服务: systemctl restart $SERVICE"
  echo "   停止服务: systemctl stop $SERVICE"
  echo "======================================"
  curl -s -m 5 "http://127.0.0.1:$PORT/api/health" || true
  echo ""
}

install_node
copy_files
install_deps
setup_service
open_port
verify
