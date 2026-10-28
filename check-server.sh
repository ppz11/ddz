#!/bin/bash
# ============================================================
#  斗地主 · 连接故障一键诊断
#  手机上提示「连接不上服务器」时，先在服务器上跑这个
#
#  用法： bash check-server.sh
# ============================================================

PORT="$(systemctl show -p Environment ddz 2>/dev/null | grep -o 'PORT=[0-9]*' | cut -d= -f2)"
PORT="${PORT:-8080}"

ok()   { echo "  ✔ $*"; }
bad()  { echo "  ✘ $*"; }
info() { echo "  · $*"; }
hd()   { echo ""; echo "=== $* ==="; }

# 公网 IP：优先阿里云元数据（国内最稳），再试公共接口
get_ip() {
  v=$(curl -s -m 3 http://100.100.100.200/latest/meta-data/public-ipv4 2>/dev/null | tr -d ' \r\n')
  if echo "$v" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then echo "$v"; return; fi
  for svc in myip.ipip.net icanhazip.com api.ipify.org ifconfig.me ip.sb; do
    v=$(curl -s -m 3 "$svc" 2>/dev/null | tr -d ' \r\n')
    if echo "$v" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then echo "$v"; return; fi
  done
  echo "(取不到)"
}

echo "======================================"
echo " 斗地主 连接故障诊断"
echo " 时间: $(date '+%F %T')"
echo "======================================"

hd "1. 服务是否在运行"
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^ddz'; then
  ST=$(systemctl is-active ddz 2>/dev/null)
  if [ "$ST" = "active" ]; then ok "systemd 服务 ddz: 运行中"
  else bad "systemd 服务 ddz: $ST（未运行）"
    info "启动命令： systemctl restart ddz"
  fi
else
  info "未找到 systemd 服务 ddz"
fi
NP=$(pgrep -f "node.*server\.js" 2>/dev/null | wc -l | tr -d ' ')
NP=${NP:-0}
if [ "$NP" -gt 0 ] 2>/dev/null; then ok "进程中检测到 $NP 个 server.js"
else bad "进程中没有 server.js"
  info "启动命令： cd /opt/ddz/server && PORT=$PORT nohup node server.js > /tmp/ddz.log 2>&1 &"
fi

hd "2. 端口是否在监听"
if command -v ss >/dev/null 2>&1; then
  L=$(ss -lntp 2>/dev/null | grep ":$PORT ")
else
  L=$(netstat -lntp 2>/dev/null | grep ":$PORT ")
fi
if [ -n "$L" ]; then ok "端口 $PORT 已监听"; echo "    $L"
else bad "端口 $PORT 没有在监听"
  info "服务没起来，或被防火墙挡了"
fi

hd "3. 本机能否访问"
C=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/")
if [ "$C" = "200" ]; then ok "本机 http://127.0.0.1:$PORT → 200"
else bad "本机访问返回 $C"
  info "看日志： journalctl -u ddz -n 50   或   tail -50 /tmp/ddz.log"
fi

hd "4. 公网 IP 与访问地址"
IP=$(get_ip)
echo "  公网 IP: $IP"
if [ "$IP" != "(取不到)" ]; then
  info "手机浏览器应该能打开： http://$IP:$PORT"
  info "APK 里的地址必须是：   http://$IP:$PORT"
else
  bad "取不到公网 IP，请用阿里云控制台里显示的「公网 IP」"
fi

hd "5. 服务器能否出网（影响 APK 里的地址是否正确）"
if curl -s -o /dev/null -m 5 https://www.baidu.com; then ok "服务器可以上网"
else bad "服务器出网受限（不影响App连接，但编译APK下载SDK会失败）"; fi

hd "6. 防火墙 / 安全组"
if command -v ufw >/dev/null 2>&1; then
  ufw status 2>/dev/null | grep -q "$PORT" && ok "ufw 已放行 $PORT" || info "ufw 未放行 $PORT（若有 ufw 需手动放行）"
fi
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --list-ports 2>/dev/null | grep -q "$PORT" && ok "firewalld 已放行 $PORT" || info "firewalld 未放行 $PORT"
fi
info "阿里云安全组需在控制台单独放行 TCP $PORT（服务器上查不到）"

hd "7. APK 里烧录的地址"
APK=""
for f in /root/ddz.apk /opt/ddz/public/ddz.apk; do
  [ -f "$f" ] && APK="$f" && break
done
if [ -n "$APK" ]; then
  echo "  找到 APK: $APK ($(du -h "$APK" | cut -f1))"
  command -v unzip >/dev/null 2>&1 || apt-get install -y -qq unzip >/dev/null 2>&1
  D=/tmp/_dexcheck; rm -rf $D; mkdir -p $D
  unzip -o -q "$APK" classes.dex -d $D 2>/dev/null
  if [ -f "$D/classes.dex" ]; then
    U=""
    command -v strings >/dev/null 2>&1 && U=$(strings "$D/classes.dex" 2>/dev/null | grep -a -o 'http://[^ "]*' | head -3)
    [ -z "$U" ] && U=$(grep -a -o 'http://[0-9a-zA-Z.:/_-]*' "$D/classes.dex" 2>/dev/null | head -3)
    if [ -n "$U" ]; then
      echo "  APK 内的地址："
      echo "$U" | sed 's/^/    /'
      if [ "$IP" != "(取不到)" ] && echo "$U" | grep -q "$IP"; then
        ok "地址与公网 IP 一致"
      else
        bad "地址与公网 IP（$IP）不一致 → 这就是连不上的原因！"
        info "重新编译： bash /root/ddz-new/ddz/build-apk-server.sh http://$IP:$PORT PP斗地主"
      fi
    else
      info "未能从 dex 中读出地址（可忽略）"
    fi
    rm -rf $D
  else
    info "APK 里没有 classes.dex，可能不是本项目的包"
  fi
else
  info "服务器上还没编译过 APK（/root/ddz.apk 不存在）"
fi

hd "8. 最近的服务日志"
if command -v journalctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^ddz'; then
  journalctl -u ddz -n 12 --no-pager 2>/dev/null | sed 's/^/    /'
elif [ -f /tmp/ddz.log ]; then
  tail -12 /tmp/ddz.log | sed 's/^/    /'
else
  info "无日志"
fi

echo ""
echo "======================================"
echo " 诊断完成"
echo "--------------------------------------"
echo " 判定方法："
echo "   手机浏览器打开 http://$IP:$PORT"
echo "   ① 浏览器也打不开 → 服务端问题（看上面 1~3、6）"
echo "   ② 浏览器能打开、App 打不开 → APK 里的地址不对（看上面 7）"
echo "======================================"
