#!/bin/bash
# ============================================================
#  斗地主 · 服务器上一键编译安卓 APK（v2）
#  不需要 GitHub、不需要 Android Studio、不需要 Gradle
#
#  用法：
#    bash build-apk-server.sh http://101.201.106.149:8080 PP斗地主
#
#  镜像探测失败时，可手动指定镜像：
#    SDK_MIRROR=https://xxx/android/repository bash build-apk-server.sh http://... PP斗地主
# ============================================================
set -o pipefail
SERVER="${1:-http://101.201.106.149:8080}"
SERVER="${SERVER%/}"
APPNAME="${2:-PP斗地主}"

WORK=/root/apk-build
SRC="$(cd "$(dirname "$0")" && pwd)/android-src"
PROJ=$WORK/proj
SDK=$WORK/sdk
OUT=/root/ddz.apk

BASES="
https://mirrors.aliyun.com/android/repository
http://mirrors.aliyun.com/android/repository
https://mirrors.aliyun.com/AndroidSDK
https://mirrors.cloud.tencent.com/AndroidSDK
https://mirrors.cloud.tencent.com/android/repository
http://mirrors.tencent.com/android/repository
http://android-mirror.bugly.qq.com:8080/android/repository
https://mirrors.ustc.edu.cn/android/repository
https://mirrors.tuna.tsinghua.edu.cn/android/repository
https://mirrors.huaweicloud.com/android/repository
https://mirrors.neusoft.edu.cn/android/repository
https://mirrors.sjtug.sjtu.edu.cn/android/repository
https://mirror.nju.edu.cn/AndroidSDK
https://mirrors.nju.edu.cn/AndroidSDK
https://mirrors.163.com/android/repository
https://mirrors.sohu.com/android/repository
https://dl.google.com/android/repository
"

PLAT_FILES="platform-33_r03.zip platform-33_r02.zip platform-34_r03.zip platform-34_r02.zip platform-33_r01.zip platform-32_r02.zip"
BT_FILES="build-tools_r33.0.3-linux.zip build-tools_r33.0.2-linux.zip build-tools_r34.0.0-linux.zip build-tools_r33.0.1-linux.zip build-tools_r30.0.3-linux.zip"

log() { echo ""; echo "### $1"; }
die() { echo ""; echo "✘ $1"; exit 1; }

# 探测某个 URL 是否可下载（用 Range 请求，省流量）
url_ok() {
  local c
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 -r 0-1024 "$1" 2>/dev/null)
  [ "$c" = "200" ] || [ "$c" = "206" ]
}

echo "======================================"
echo " 斗地主 APK 编译 v2"
echo " 服务器地址: $SERVER"
echo " 应用名称:   $APPNAME"
echo "======================================"

# 地址格式校验：地址会被烧进 APK，填错就永远连不上
BAD=0
case "$SERVER" in
  http://*|https://*) ;;
  *) BAD=1 ;;
esac
HOSTPART=$(echo "$SERVER" | sed -e 's|^https\?://||' -e 's|/.*$||' -e 's|:.*$||')
if ! echo "$HOSTPART" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
  if ! echo "$HOSTPART" | grep -Eq '^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'; then BAD=1; fi
fi
if [ "$BAD" = "1" ]; then
  echo ""
  echo "✘ 服务器地址不合法：$SERVER"
  echo "  必须是这种格式（IP 或域名，带 http://）："
  echo "    bash build-apk-server.sh http://101.201.106.149:8080 PP斗地主"
  echo ""
  echo "  你的公网 IP 可以这样查（在服务器上执行）："
  echo "    curl -s http://100.100.100.200/latest/meta-data/public-ipv4"
  echo "  或去阿里云控制台 → ECS → 实例详情里看「公网 IP」"
  exit 1
fi
echo "✔ 地址格式校验通过（主机名：$HOSTPART）"

# ---------- 0. 基础工具 ----------
log "0/6 安装基础工具（JDK 等）"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq unzip zip curl 2>/dev/null || true
if ! command -v java >/dev/null 2>&1; then
  apt-get update -qq || true
  apt-get install -y -qq openjdk-17-jdk-headless 2>&1 | tail -3 || \
  apt-get install -y -qq openjdk-11-jdk-headless 2>&1 | tail -3 || \
  die "JDK 安装失败，请手动执行：apt-get install -y openjdk-17-jdk-headless"
fi
command -v java >/dev/null 2>&1 || die "找不到 java"
echo "✔ $(java -version 2>&1 | head -1)"

mkdir -p "$WORK" "$SDK/platforms" "$SDK/build-tools"

# ---------- 1. 定位可用镜像与文件 ----------
log "1/6 定位 Android SDK 下载地址"
PLAT_URL=""; BT_URL=""

if [ -n "$SDK_MIRROR" ]; then
  echo "使用手动指定的镜像: $SDK_MIRROR"
  for f in $PLAT_FILES; do url_ok "$SDK_MIRROR/$f" && { PLAT_URL="$SDK_MIRROR/$f"; break; }; done
  for f in $BT_FILES;   do url_ok "$SDK_MIRROR/$f" && { BT_URL="$SDK_MIRROR/$f";   break; }; done
else
  echo "逐个尝试镜像（每个最多 12 秒）..."
  for b in $BASES; do
    [ -n "$PLAT_URL" ] && [ -n "$BT_URL" ] && break
    for f in $PLAT_FILES; do
      if [ -z "$PLAT_URL" ] && url_ok "$b/$f"; then
        PLAT_URL="$b/$f"; echo "  ✔ platform: $PLAT_URL"; break
      fi
    done
    for f in $BT_FILES; do
      if [ -z "$BT_URL" ] && url_ok "$b/$f"; then
        BT_URL="$b/$f"; echo "  ✔ build-tools: $BT_URL"; break
      fi
    done
  done
fi

[ -n "$PLAT_URL" ] || die "找不到 Android platform 下载地址
请执行 bash probe-mirrors.sh 看看哪些镜像能通，把结果发我"
[ -n "$BT_URL" ]   || die "找不到 build-tools 下载地址
请执行 bash probe-mirrors.sh 看看哪些镜像能通，把结果发我"

PLAT_ZIP="$(basename "$PLAT_URL")"
BT_ZIP="$(basename "$BT_URL")"

# ---------- 2. 下载并解压 ----------
log "2/6 下载 Android SDK（约 110MB，请稍候）"
dl() {
  local url="$1" name="$2"
  if [ -f "$WORK/$name" ] && [ -s "$WORK/$name" ]; then echo "  已有缓存: $name"; return 0; fi
  echo "  下载: $name"
  curl -fL --connect-timeout 20 --retry 3 --retry-delay 2 --max-time 900 \
       -o "$WORK/$name" "$url" || return 1
}
dl "$PLAT_URL" "$PLAT_ZIP" || die "下载 $PLAT_ZIP 失败"
dl "$BT_URL"   "$BT_ZIP"   || die "下载 $BT_ZIP 失败"
echo "✔ 下载完成（$(du -sh "$WORK" | cut -f1)）"

if [ ! -f "$SDK/platforms/android-33/android.jar" ]; then
  rm -rf "$WORK/x-platform"; mkdir -p "$WORK/x-platform"
  unzip -q "$WORK/$PLAT_ZIP" -d "$WORK/x-platform" || die "解压 $PLAT_ZIP 失败"
  PJ=$(find "$WORK/x-platform" -name android.jar | head -1)
  [ -n "$PJ" ] || die "platform 包里没有 android.jar"
  rm -rf "$SDK/platforms/android-33"; mkdir -p "$SDK/platforms/android-33"
  cp -r "$(dirname "$PJ")"/. "$SDK/platforms/android-33"/
  echo "✔ platform 就位"
else
  echo "✔ platform 已存在"
fi

if [ ! -f "$SDK/build-tools/33.0.3/aapt2" ]; then
  rm -rf "$WORK/x-bt"; mkdir -p "$WORK/x-bt"
  unzip -q "$WORK/$BT_ZIP" -d "$WORK/x-bt" || die "解压 $BT_ZIP 失败"
  A2=$(find "$WORK/x-bt" -name aapt2 -type f | head -1)
  [ -n "$A2" ] || die "build-tools 包里没有 aapt2"
  rm -rf "$SDK/build-tools/33.0.3"; mkdir -p "$SDK/build-tools/33.0.3"
  cp -r "$(dirname "$A2")"/. "$SDK/build-tools/33.0.3"/
  chmod +x "$SDK/build-tools/33.0.3"/* 2>/dev/null
  echo "✔ build-tools 就位"
else
  echo "✔ build-tools 已存在"
fi

PJAR="$SDK/platforms/android-33/android.jar"
BT="$SDK/build-tools/33.0.3"
[ -f "$PJAR" ] || die "android.jar 缺失"
[ -x "$BT/aapt2" ] || chmod +x "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" 2>/dev/null

# ---------- 3. 准备工程 ----------
log "3/6 准备安卓工程"
rm -rf "$PROJ"; mkdir -p "$PROJ"
cp -r "$SRC"/. "$PROJ"/
sed -i "s|__SERVER_URL__|$SERVER|g" "$PROJ/src/com/yuanbao/ddz/MainActivity.java"
grep -q "$SERVER" "$PROJ/src/com/yuanbao/ddz/MainActivity.java" || die "服务器地址注入失败"
echo "✔ 服务器地址: $SERVER"
sed -i "s|<string name=\"app_name\">.*</string>|<string name=\"app_name\">$APPNAME</string>|" \
  "$PROJ/res/values/strings.xml"
echo "✔ 应用名称:   $APPNAME"

cd "$PROJ"
rm -rf build; mkdir -p build/gen build/classes build/dex

# ---------- 4. 编译资源 ----------
log "4/6 编译资源"
"$BT/aapt2" compile --dir res -o build/res.zip || die "aapt2 compile 失败"
"$BT/aapt2" link -I "$PJAR" --manifest AndroidManifest.xml \
  -o build/unsigned.apk --java build/gen --auto-add-overlay \
  --min-sdk-version 24 --target-sdk-version 33 build/res.zip || die "aapt2 link 失败"
echo "✔ 资源编译完成"

# ---------- 5. 编译代码 ----------
log "5/6 编译代码"
find src build/gen -name "*.java" > build/sources.txt
javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$PJAR" \
  -classpath "$PJAR" -d build/classes @build/sources.txt 2>&1 | grep -v "warning\|obsolete\|deprecat" || true
[ -f build/classes/com/yuanbao/ddz/MainActivity.class ] || die "javac 编译失败"
"$BT/d8" --lib "$PJAR" --min-api 24 --output build/dex \
  $(find build/classes -name "*.class") 2>&1 | tail -3
[ -f build/dex/classes.dex ] || die "d8 转换 dex 失败"
echo "✔ 代码编译完成"

cp build/unsigned.apk build/merged.apk
zip -qj build/merged.apk build/dex/classes.dex || die "打包 dex 失败"
"$BT/zipalign" -f 4 build/merged.apk build/aligned.apk 2>/dev/null \
  || cp build/merged.apk build/aligned.apk

if [ ! -f "$WORK/debug.keystore" ]; then
  keytool -genkeypair -v -keystore "$WORK/debug.keystore" -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android \
    -dname "CN=DDZ, O=DDZ, C=CN" 2>&1 | tail -2
fi
"$BT/apksigner" sign --ks "$WORK/debug.keystore" --ks-pass pass:android \
  --key-pass pass:android --ks-key-alias androiddebugkey \
  --out build/signed.apk build/aligned.apk 2>/dev/null \
  || jarsigner -keystore "$WORK/debug.keystore" -storepass android -keypass android \
     -signedjar build/signed.apk build/aligned.apk androiddebugkey \
  || die "签名失败"
echo "✔ 签名完成"

# ---------- 6. 输出 ----------
log "6/6 输出安装包"
cp build/signed.apk "$OUT"
WEBURL=""
if [ -d /opt/ddz/public ]; then
  cp build/signed.apk /opt/ddz/public/ddz.apk
  WEBURL="$SERVER/ddz.apk"
fi
SIZE=$(du -h "$OUT" | cut -f1)

# 回读 APK 里实际烧录的地址，防止 sed 替换没生效
D=/tmp/_dexv; rm -rf $D; mkdir -p $D
unzip -o -q "$OUT" classes.dex -d $D 2>/dev/null
if [ -f "$D/classes.dex" ]; then
  BU=$( (command -v strings >/dev/null 2>&1 && strings "$D/classes.dex" | grep -a -o 'http://[^ "]*' | head -1) \
        || grep -a -o 'http://[0-9a-zA-Z.:/_-]*' "$D/classes.dex" | head -1 )
  if [ -n "$BU" ]; then
    echo ""
    if [ "$BU" = "$SERVER" ]; then
      echo "✔ APK 内地址校验通过：$BU"
    else
      echo "✘ APK 内地址是「$BU」，与你填的「$SERVER」不一致！请检查后重新编译"
    fi
  fi
  rm -rf $D
fi

echo ""
echo "======================================"
echo " APK 编译成功 🎉"
echo " 名称: $APPNAME"
echo " 大小: $SIZE"
echo " 路径: $OUT"
if [ -n "$WEBURL" ]; then
  echo "--------------------------------------"
  echo " 手机浏览器打开下载："
  echo "   $WEBURL"
fi
echo "======================================"
