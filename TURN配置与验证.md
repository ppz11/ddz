# TURN 中继：配置与验证步骤

> 适用：v37 及以后（含 v39）。语音/视频通话跨网络（WiFi ↔ 4G、不同运营商）必须经 TURN 中继，否则「能拨通但黑屏 / 没声音」。
> 本文档对着 `deploy/setup-turn.sh` 与 `server/server.js` 的 `iceConfig()` 写，命令可直接复制。

---

## 0. 先说清楚：怎么算「配好了」

`/api/ice` 里的 `relay:true` **只代表服务端下发了 TURN 凭证**，不代表 coturn 真在跑、端口真通。

必须同时满足 4 条：

| # | 条件 | 怎么查 |
|---|---|---|
| 1 | 进程里有 `TURN_SECRET` / `TURN_URLS` | `/proc/PID/environ` |
| 2 | `/api/ice` 返回 `relay:true`，`iceServers` 含 `turn:` | curl |
| 3 | coturn 在跑、3478 在监听 | `systemctl` / `ss -lunp` |
| 4 | **阿里云安全组**放行 UDP 3478 + UDP 49152-65535 | 只能在控制台看，命令行查不到 |

> 脚本没跑或环境变量没进进程时，`/api/ice` 会返回 `relay:false` 并带 `hint` 说明。
> 另一个假阳性：只设了 `TURN_SECRET`、没设 `TURN_URLS` 时，服务端会按请求 Host 推断 TURN 地址 —— 这时 `relay:true` 也可能是「配了密钥但 coturn 根本没装」。

---

## 一、验证：我配了没？

**状态：`root@iZ...:/opt/ddz#`**，整段粘贴：

```bash
echo "===== 1 服务下发了什么 ====="
curl -s http://127.0.0.1:8080/api/ice | python3 -m json.tool

echo "===== 2 进程实际拿到的环境变量（最硬的一条）====="
PID=$(pgrep -f "server/server.js" | head -1)
echo "PID=$PID"
tr '\0' '\n' < /proc/$PID/environ | grep -E '^TURN_|^PORT=' || echo "✘ 进程里没有 TURN 变量"

echo "===== 3 coturn 装了没、跑着没 ====="
command -v turnserver || echo "✘ 没装 coturn"
systemctl is-active coturn 2>/dev/null || echo "(coturn 未由 systemd 管理)"
pgrep -a turnserver || echo "✘ 没有 turnserver 进程"
ss -lunp | grep -E ':3478|:4915|:5[0-9]{4}' || echo "✘ 3478/中继端口没在监听"
ls -l /etc/ddz/turn.env /etc/turnserver.conf 2>/dev/null || echo "✘ 配置文件不存在"

echo "===== 4 服务是被谁拉起的 ====="
ps -o pid,ppid,cmd -p $PID
grep -i "systemd\|supervisor" /proc/$PID/cgroup 2>/dev/null
systemctl list-units --type=service --all --no-legend 2>/dev/null | grep -iE 'ddz|node' || echo "(没找到名字含 ddz 的 unit)"
```

### 判读

| 现象 | 结论 | 下一步 |
|---|---|---|
| `relay:false` 或第 2 段打印「没有 TURN 变量」 | **没配**（或脚本第 8 步没生效） | 走「二、配置」 |
| `relay:true` 但 `turnserver` 不存在 | **假阳性**：只有密钥，没有中继服务 | 走「二、配置」装 coturn |
| `relay:true` + coturn active + 3478 监听 | 服务端侧配好了 | 只剩安全组，走「四、外网验证」 |
| 第 1 段用 `127.0.0.1` 返回 `relay:false`，但用公网 IP 返回 `true` | `TURN_URLS` 没显式设置，Host 推断跳过了 localhost | 补 `TURN_URLS=turn:101.201.106.149:3478` |

> 补充验证（避免 localhost 推断干扰）：`curl -s http://101.201.106.149:8080/api/ice | python3 -m json.tool`

---

## 二、配置（没配就做）

### 第 1 步：取出安装脚本

```bash
cd /opt/ddz
if [ ! -f deploy/setup-turn.sh ]; then
  unzip -o /root/ddz-v39.zip deploy/setup-turn.sh
fi
ls -l deploy/setup-turn.sh
```

> 若 `/root/ddz-v39.zip` 不在，本地（PC）执行：
> `scp ~/ddz-v39.zip root@101.201.106.149:/root/`

### 第 2 步：跑脚本（root）

```bash
cd /opt/ddz && bash deploy/setup-turn.sh
```

脚本会：apt 装 coturn → 生成密钥 → 写 `/etc/turnserver.conf`（3478、UDP 中继 49152-65535、临时凭证模式）→ 写 `/etc/ddz/turn.env`（chmod 600）→ 放行 iptables/ufw → 启 coturn。

跑完记下它打印的 `TURN 地址 : turn:公网IP:3478`。

### 第 3 步（关键）：把环境变量真正送进 node 进程

⚠️ **脚本第 8 步只对 `/etc/systemd/system/ddz.service` 生效，且要求该文件里已有 `Environment=PORT=` 这一行。** 你的服务如果 unit 名字不叫 `ddz`、或由 nohup/守护脚本拉起，环境变量就不会进去 —— 脚本照样打印「✔ ddz 已重启」，但 `/api/ice` 仍是 `relay:false`。这是最容易踩的坑。

`server.js` 只读 `process.env`，**不会自己读 `/etc/ddz/turn.env`**。

**A. systemd 管理（PPID=1 / cgroup 里有 systemd）**

```bash
UNIT=$(systemctl list-units --type=service --all --no-legend 2>/dev/null | grep -i ddz | awk '{print $1}' | head -1)
echo "UNIT=$UNIT"

# 用 override 引入密钥文件，不动原 unit，幂等
mkdir -p "/etc/systemd/system/${UNIT}.d"
printf '[Service]\nEnvironmentFile=/etc/ddz/turn.env\n' > "/etc/systemd/system/${UNIT}.d/turn.conf"
systemctl daemon-reload
systemctl restart "$UNIT"
sleep 3
```

若 `UNIT` 为空，先定位：

```bash
PID=$(pgrep -f "server/server.js" | head -1)
systemctl status "$PID" --no-pager | head -8
```

**B. 不是 systemd（nohup / 自定义守护脚本）**

在启动命令前加一句 source：

```bash
set -a; . /etc/ddz/turn.env; set +a
cd /opt/ddz && nohup node server/server.js > /tmp/ddz.log 2>&1 &
```

或直接 kill 让现有守护拉起（前提是该守护的启动脚本里已 source）：

```bash
kill -9 $(pgrep -f "server/server.js"); sleep 4; pgrep -af node
```

**C. 快速验证用（不持久，重启机器会丢）**

```bash
SECRET=$(grep '^TURN_SECRET=' /etc/ddz/turn.env | cut -d= -f2-)
systemctl set-environment TURN_SECRET="$SECRET" TURN_URLS="turn:101.201.106.149:3478"
```

### 第 4 步：确认变量进去了

```bash
PID=$(pgrep -f "server/server.js" | head -1)
tr '\0' '\n' < /proc/$PID/environ | grep '^TURN_'
curl -s http://127.0.0.1:8080/api/ice | python3 -m json.tool
```

✅ 应看到 `TURN_SECRET=...`、`TURN_URLS=turn:...`，且 `relay: true`、`iceServers` 里有 `turn:101.201.106.149:3478` 带 `username`/`credential`。

### 第 5 步：阿里云安全组（控制台，命令行做不了）

ECS 控制台 → 实例 → 安全组 → 配置规则 → **入方向** 添加：

| 协议 | 端口 | 授权对象 | 说明 |
|---|---|---|---|
| UDP | 3478 | 0.0.0.0/0 | TURN 信令（主用） |
| TCP | 3478 | 0.0.0.0/0 | `?transport=tcp` 备用路径 |
| UDP | 49152-65535 | 0.0.0.0/0 | **媒体中继端口段，漏了照样黑屏** |
| TCP | 5349 | 0.0.0.0/0 | TLS，可选 |

> iptables/ufw 放行 ≠ 安全组放行。阿里云 ECS 是 NAT 网络，外网流量先过安全组。

### 第 6 步：阿里云 NAT 的 external-ip 修正（按需）

ECS 网卡只有内网 IP（如 `172.25.134.70`），公网 `101.201.106.149` 是映射。脚本写的 `external-ip=公网IP` 在 NAT 环境下可能导致中继地址分配失败。若第「三」步测试不通或日志出现地址绑定错误，改成 `公网/内网` 形式：

```bash
PRIV=$(hostname -I | awk '{print $1}')
PUB=101.201.106.149
sed -i "s|^external-ip=.*|external-ip=${PUB}/${PRIV}|" /etc/turnserver.conf
grep -q '^relay-ip=' /etc/turnserver.conf || echo "relay-ip=${PRIV}" >> /etc/turnserver.conf
grep -nE '^(external-ip|relay-ip|static-auth-secret|min-port|max-port)' /etc/turnserver.conf
systemctl restart coturn
sleep 2
systemctl is-active coturn
```

---

## 三、验证 TURN 真能中继（比 `relay:true` 更硬）

### 1. 本机功能测试（临时凭证模式，必须用 HMAC 生成的短期账号）

```bash
SECRET=$(grep '^TURN_SECRET=' /etc/ddz/turn.env | cut -d= -f2-)
TS=$(($(date +%s) + 86400))
U="${TS}:ddztest"
W=$(node -e 'const c=require("crypto");process.stdout.write(c.createHmac("sha1",process.argv[1]).update(process.argv[2]).digest("base64"))' "$SECRET" "$U")

turnutils_uclient -t -u "$U" -w "$W" -p 3478 -n 1 127.0.0.1
```

✅ 看到分配成功、无 `error` / `refused` / `401` 即通过。
❌ 报认证失败 → node 与 coturn 的 SECRET 不一致，核对 `/etc/ddz/turn.env` 与 `/etc/turnserver.conf` 里的 `static-auth-secret`。

> `turnutils_uclient` 来自 coturn 包；若命令不存在：`apt-get install -y coturn-utils`（或直接 `apt-get install -y coturn` 重装）。

### 2. 看日志

```bash
tail -50 /var/log/turnserver.log
ss -lunp | grep 3478
systemctl is-active coturn
```

### 3. 从外网测（验证安全组）

在**另一台机器**（例如你的 PC `rthf@rthf-pc`，非服务器）上：

```bash
sudo apt-get install -y coturn-utils
turnutils_uclient -t -u "<上面的U>" -w "<上面的W>" -p 3478 -n 1 101.201.106.149
```

✅ 通 = 安全组放行了。超时/不通 = 回控制台查安全组规则。

> 也可以用手机/PC 浏览器打开 WebRTC 的 trickle-ice 测试页，填入 `turn:101.201.106.149:3478` 和上面的临时账号密码，看能否收集到 `relay` 类型 candidate。

### 4. 最终实测（必做）

两台设备，**一台 WiFi、一台 4G/5G**，发起视频通话：

- 有画面有声音 → TURN 生效
- 通话期间 `tail -f /var/log/turnserver.log` 应能看到新的 allocation / 转发记录
- 仍黑屏 → 把 `/api/ice` 输出、`/var/log/turnserver.log` 最后 50 行、以及两台设备的网络环境发我

---

## 四、常见坑速查

| 现象 | 原因 |
|---|---|
| `/api/ice` 一直 `relay:false` | 环境变量没进 node 进程（脚本第 8 步的坑）→ 走「二·第 3 步」 |
| `relay:true` 但通话还是黑屏 | coturn 没装 / 没启动 / 安全组没放行 UDP 49152-65535 |
| `curl 127.0.0.1/api/ice` 是 false，公网 IP 访问是 true | `TURN_URLS` 没显式写，Host 推断跳过 localhost；显式设上即可一致 |
| 401 / 认证失败 | node 的 `TURN_SECRET` 与 coturn 的 `static-auth-secret` 不一致 |
| 同 WiFi 能通、跨网络不通 | 典型缺 TURN（Google STUN 在国内基本不可达） |
| 装完重启服务器后又不行 | coturn 没设开机自启：`systemctl enable coturn`；环境变量用的是 override 文件才会持久 |

---

## 五、安全提醒

- `/etc/ddz/turn.env` 是 600 权限，**不要提交到 GitHub**，也不要放进 `public/`。
- 脚本生成的 `denied-peer-ip` 已禁止把服务器当开放代理，别删。
- TURN 会消耗服务器带宽（媒体流经中转），`max-bps` 如需限速可自行调整。
- 配 TURN 与编 APK 互不依赖：服务端这边可以现在就配，v39 的 APK 照常编译安装。
