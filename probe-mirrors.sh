#!/bin/bash
# ============================================================
#  Android SDK 镜像连通性探测
#  用法： bash probe-mirrors.sh
#  把输出结果截图发给我即可
# ============================================================
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

FILES="platform-33_r03.zip build-tools_r33.0.3-linux.zip commandlinetools-linux-11076708_latest.zip"

echo "======================================"
echo " Android SDK 镜像探测"
echo "======================================"
echo ""
printf "%-58s %-28s %s\n" "镜像" "文件" "结果"
echo "--------------------------------------------------------------------------------"

FOUND=0
for b in $BASES; do
  for f in $FILES; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 -r 0-1024 "$b/$f" 2>/dev/null)
    if [ "$code" = "200" ] || [ "$code" = "206" ]; then
      printf "%-58s %-28s \033[32m%s 可用\033[0m\n" "${b:0:58}" "$f" "$code"
      FOUND=$((FOUND+1))
    else
      printf "%-58s %-28s %s\n" "${b:0:58}" "$f" "${code:-失败}"
    fi
  done
done

echo ""
echo "======================================"
if [ "$FOUND" -gt 0 ]; then
  echo " 找到 $FOUND 个可用地址 ✅"
  echo " 记下上面标记为「可用」的镜像地址（https:// 开头那一段）"
  echo " 然后执行："
  echo "   SDK_MIRROR=可用镜像地址 bash build-apk-server.sh http://101.201.106.149:8080 PP斗地主"
else
  echo " 全部不可用 ❌"
  echo " 说明这台服务器访问不到 Android SDK 镜像"
  echo " 请把本页截图发我，我换方案（改用在线打包 / Gitee Go 流水线）"
fi
echo "======================================"

echo ""
echo "--- 附加信息（一起截图）---"
echo -n "外网连通性(百度): "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://www.baidu.com 2>/dev/null || echo 失败
echo -n "apt 源: "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://archive.ubuntu.com 2>/dev/null || echo 失败
echo -n "本机出口IP: "
curl -s --max-time 10 https://myip.ipip.net 2>/dev/null | head -c 60 || echo 未知
echo ""
