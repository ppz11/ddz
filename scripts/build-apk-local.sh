#!/usr/bin/env bash
# ============================================================
# 本地编译 APK —— 不依赖任何代码托管平台
#
# 适用：Ubuntu / Debian / WSL（其他发行版把 apt 换成自己的包管理器）
# 作用：自动装 JDK17 + Android SDK + 配国内镜像，然后编译出 APK
#
# 用法：
#   1) 先改下面的 SERVER_URL 为你自己的服务器地址
#   2) chmod +x scripts/build-apk-local.sh
#   3) bash scripts/build-apk-local.sh
#
# 全程走国内镜像（阿里云 / 腾讯云 / 淘宝 npm），不需要访问境外网络
# ============================================================

set -e

# ====== 必改：你的服务器地址 ======
SERVER_URL="http://你的公网IP:8080"

# ====== 可选：Android 编译版本 ======
ANDROID_PLATFORM="android-34"
BUILD_TOOLS="34.0.0"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="$HOME/android-sdk"
echo "项目目录: $ROOT"
echo "SDK 目录: $SDK_DIR"
echo

# ------------------------------------------------------------
# 1. 检查 / 安装 JDK 17
# ------------------------------------------------------------
echo "== 1/7 检查 JDK 17 =="
if command -v java >/dev/null 2>&1 && java -version 2>&1 | grep -q 'version "17'; then
  echo "✔ 已有 JDK 17: $(java -version 2>&1 | head -1)"
else
  echo "安装 JDK 17（需要 sudo 密码）..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq openjdk-17-jdk
  echo "✔ JDK 17 安装完成"
fi
export JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
echo "JAVA_HOME=$JAVA_HOME"
echo

# ------------------------------------------------------------
# 2. 检查 / 安装 Android SDK 命令行工具
# ------------------------------------------------------------
echo "== 2/7 检查 Android SDK =="
mkdir -p "$SDK_DIR/cmdline-tools"
if [ ! -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "下载 Android 命令行工具（腾讯云镜像）..."
  CDK="$HOME/commandlinetools-linux.zip"
  # 腾讯镜像；若失效可换 https://mirrors.aliyun.com/android.googlesource.com/ 或官方地址
  curl -fL -o "$CDK" "https://mirrors.tencent.com/AndroidSDK/commandlinetools-linux-11076708_latest.zip" \
    || curl -fL -o "$CDK" "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  rm -rf "$SDK_DIR/cmdline-tools/latest"
  mkdir -p "$SDK_DIR/cmdline-tools/latest"
  unzip -q "$CDK" -d "$SDK_DIR/cmdline-tools/tmp" 2>/dev/null || unzip -q "$CDK" -d "$SDK_DIR/cmdline-tools/latest"
  if [ -d "$SDK_DIR/cmdline-tools/tmp/cmdline-tools" ]; then
    mv "$SDK_DIR/cmdline-tools/tmp/cmdline-tools/"* "$SDK_DIR/cmdline-tools/latest/"
    rm -rf "$SDK_DIR/cmdline-tools/tmp"
  fi
  rm -f "$CDK"
  echo "✔ 命令行工具已就位"
fi
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="$PATH:$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools"
echo "ANDROID_HOME=$ANDROID_HOME"
echo

# ------------------------------------------------------------
# 3. 接受许可 + 安装编译所需组件
# ------------------------------------------------------------
echo "== 3/7 安装 Android 编译组件 =="
mkdir -p "$SDK_DIR/licenses"
cat > "$SDK_DIR/licenses/android-sdk-license" <<'LIC'
24333f8a63b6825ea9c5514f83c2829b004d1fee
LIC
cat > "$SDK_DIR/licenses/android-sdk-preview-license" <<'LIC'
84831b9409646a918e30573bab4c9c91346d8abd
LIC
yes | sdkmanager --sdk_root="$SDK_DIR" --licenses >/dev/null 2>&1 || true
sdkmanager --sdk_root="$SDK_DIR" "platform-tools" "platforms;$ANDROID_PLATFORM" "build-tools;$BUILD_TOOLS" 2>&1 | tail -5
echo "✔ 组件安装完成"
ls "$SDK_DIR" | tr '\n' ' '; echo
echo

# ------------------------------------------------------------
# 4. 配置 Gradle 国内镜像（关键，不配必卡）
# ------------------------------------------------------------
echo "== 4/7 配置 Gradle 镜像 =="
mkdir -p "$HOME/.gradle"
cp "$ROOT/scripts/gradle-init-mirror.gradle" "$HOME/.gradle/init.gradle"
echo "✔ ~/.gradle/init.gradle 已写入"
echo

# ------------------------------------------------------------
# 5. 安装 npm 依赖 + 生成前端资源
# ------------------------------------------------------------
echo "== 5/7 生成前端资源 =="
cd "$ROOT"
npm config set registry https://registry.npmmirror.com
npm install
APP_SERVER="$SERVER_URL" npm run build:www
echo "✔ www 已生成: $(ls www | tr '\n' ' ')"
echo

# ------------------------------------------------------------
# 6. 生成安卓工程 + 注入原生能力
# ------------------------------------------------------------
echo "== 6/7 生成安卓工程 =="
npx cap add android 2>/dev/null || echo "（android 工程已存在，跳过）"
npx cap sync android

# Gradle 发行包走腾讯云镜像
if [ -f android/gradle/wrapper/gradle-wrapper.properties ]; then
  sed -i 's|distributionUrl=.*|distributionUrl=https\\://mirrors.cloud.tencent.com/gradle/gradle-8.0-bin.zip|' \
    android/gradle/wrapper/gradle-wrapper.properties
  echo "✔ Gradle 发行包已切到腾讯云镜像"
fi

# 原生桥接 MainActivity
MJ=android/app/src/main/java/com/yuanbao/ddz/MainActivity.java
cp -f android-src/capacitor/MainActivity.java "$MJ"
grep -q "DDZNative" "$MJ" || { echo "✘ DDZNative 注入失败"; exit 1; }

# 明文访问：Android 9+ 默认禁止 http/ws，不放行 App 必报「连接服务器失败」
mkdir -p android/app/src/main/res/xml
cp -f android-src/res/xml/network_security_config.xml android/app/src/main/res/xml/
MF=android/app/src/main/AndroidManifest.xml
python3 - <<'PYEOF'
import re
p = "android/app/src/main/AndroidManifest.xml"
s = open(p, encoding="utf-8").read()
if 'android:usesCleartextTraffic' not in s:
    s = re.sub(r'<application(\s|>)', r'<application android:usesCleartextTraffic="true"\1', s, count=1)
if 'android:networkSecurityConfig' not in s:
    s = re.sub(r'<application(\s|>)', r'<application android:networkSecurityConfig="@xml/network_security_config"\1', s, count=1)
s = s.replace('android:screenOrientation="portrait"', 'android:screenOrientation="fullSensor"')
s = s.replace('android:screenOrientation="landscape"', 'android:screenOrientation="fullSensor"')
open(p, "w", encoding="utf-8").write(s)
print("✔ 明文访问 + 网络安全配置已注入")
PYEOF
for p in RECORD_AUDIO CAMERA MODIFY_AUDIO_SETTINGS; do
  grep -q "android.permission.$p" "$MF" || \
    sed -i "0,/<uses-permission/s|<uses-permission |<uses-permission android:name=\"android.permission.$p\"/>\n    <uses-permission |" "$MF"
done
grep -q 'usesCleartextTraffic="true"' "$MF" && echo "✔ 明文访问已放行" || { echo "✘ 明文访问未放行"; exit 1; }
[ -d android-src/res ] && cp -rf android-src/res/. android/app/src/main/res/
echo "✔ 原生能力已注入"
echo

# ------------------------------------------------------------
# 7. 编译
# ------------------------------------------------------------
echo "== 7/7 编译 APK（首次约 10~20 分钟，之后 3~5 分钟）=="
cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon

cd "$ROOT"
mkdir -p dist
cp android/app/build/outputs/apk/debug/app-debug.apk dist/ddz.apk
echo
echo "=========================================="
echo "  ✔ 编译完成"
echo "  APK: $ROOT/dist/ddz.apk"
echo "  大小: $(du -h dist/ddz.apk | cut -f1)"
echo "  服务器: $SERVER_URL"
echo "=========================================="
