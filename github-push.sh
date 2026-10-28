#!/bin/bash
# ============================================================
#  把 /root/ddz 推送到你的 GitHub 仓库
#  用法： bash github-push.sh 你的用户名 仓库名 你的Token
#  例：   bash github-push.sh zhangsan ddz ghp_xxxxxxxxxxxx
# ============================================================
set -o pipefail
USER="$1"; REPO="$2"; TOKEN="$3"

[ -n "$USER" ]  || { echo "✘ 缺少用户名"; echo "用法: bash github-push.sh 用户名 仓库名 Token"; exit 1; }
[ -n "$REPO" ]  || { echo "✘ 缺少仓库名"; exit 1; }
[ -n "$TOKEN" ] || { echo "✘ 缺少 Token（去 GitHub Settings → Developer settings → Personal access tokens 生成）"; exit 1; }

echo "======================================"
echo " 推送到 GitHub"
echo " 目标: https://github.com/$USER/$REPO"
echo "======================================"

# ---------- 0. 装 git ----------
if ! command -v git >/dev/null 2>&1; then
  echo "→ 安装 git ..."
  apt-get update -qq 2>/dev/null
  apt-get install -y -qq git 2>&1 | tail -2 || yum install -y git 2>&1 | tail -2
fi
command -v git >/dev/null 2>&1 || { echo "✘ git 安装失败"; exit 1; }
echo "✔ $(git --version)"

# ---------- 1. 连通性 ----------
echo ""
echo "→ 测试 GitHub 连通性 ..."
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://github.com 2>/dev/null)
echo "  github.com -> $code"
if [ "$code" != "200" ] && [ "$code" != "301" ] && [ "$code" != "302" ]; then
  echo "⚠ 这台服务器连 GitHub 可能有问题（返回 $code）"
  echo "  继续尝试，失败的话请改在你自己电脑上操作"
fi

# ---------- 2. 初始化 ----------
cd /root/ddz || { echo "✘ 找不到 /root/ddz"; exit 1; }

cat > .gitignore <<'EOF'
node_modules/
www/
android/
data/
shots5/
*.log
*.apk
.DS_Store
EOF

if [ ! -d .git ]; then
  git init -q
  git config core.autocrlf false
fi
git config user.email "ddz@example.com"
git config user.name  "$USER"

git add -A 2>&1 | tail -3
CNT=$(git diff --cached --name-only | wc -l)
echo "✔ 待提交文件: $CNT 个"

git commit -q -m "斗地主 PP版：改名 + 安卓工程" 2>&1 | tail -3 || echo "（无改动或已提交）"

# ---------- 3. 推送 ----------
git branch -M main 2>/dev/null
git remote remove origin 2>/dev/null
git remote add origin "https://$USER:$TOKEN@github.com/$USER/$REPO.git"

echo ""
echo "→ 推送中 ..."
if git push -u origin main 2>&1 | tail -8; then
  echo ""
  echo "======================================"
  echo " 推送成功 ✅"
  echo "======================================"
  echo " 下一步："
  echo " 1. 打开 https://github.com/$USER/$REPO"
  echo " 2. 点顶部 Actions"
  echo " 3. 左侧点「编译安卓安装包」"
  echo " 4. 右侧点 Run workflow → 填服务器地址 → 运行"
  echo "======================================"
else
  echo ""
  echo "======================================"
  echo " 推送失败 ❌ 常见原因："
  echo " 1. Token 不对或没勾 repo 权限"
  echo " 2. 仓库还没在 GitHub 上创建（先去网页建一个空的）"
  echo " 3. 仓库名/用户名写错"
  echo "======================================"
  exit 1
fi
