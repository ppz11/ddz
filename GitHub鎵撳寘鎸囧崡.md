# GitHub 路线 · 完整操作指南

> GitHub 能连上了，就走这条路——**最稳，不依赖服务器网络**。
> 全程约 20 分钟，其中编译约 10 分钟自动完成。

---

## 总览

```
建仓库 → 生成 Token → 推代码 → 跑 Actions → 下载 APK
```

---

## 第 1 步：创建仓库（2 分钟）

1. 打开 https://github.com/new
2. **Repository name** 填：`ddz`
3. 选 **Public**（公开仓库 Actions 免费无限时；私有仓库每月只有 2000 分钟）
4. ❌ **不要**勾 "Add a README file"，保持完全空仓库
5. 点 **Create repository**

创建完会显示一个空仓库页面，**先别关**。

---

## 第 2 步：生成 Token（关键，3 分钟）

GitHub 现在**不能用密码推送代码**，必须用 Token。

1. 打开 https://github.com/settings/tokens
2. 点 **Generate new token** → 选 **Generate new token (classic)**
3. 填写：
   - **Note**：随便填，比如 `ddz`
   - **Expiration**：选 `90 days`（或 No expiration）
   - **Select scopes**：勾选 **repo**（勾这一项会自动勾上它下面所有子项）
4. 拉到最底，点 **Generate token**
5. ⚠️ **立刻复制那串 `ghp_` 开头的字符串**，关掉页面就再也看不到了

---

## 第 3 步：推送代码（3 分钟）

在**服务器网页终端**执行：

```bash
cd /root/ddz && chmod +x github-push.sh
bash github-push.sh 你的GitHub用户名 ddz 刚才复制的Token
```

例如：

```bash
bash github-push.sh zhangsan ddz ghp_xxxxxxxxxxxxxxxxxxxx
```

看到「推送成功 ✅」就对了。

### 如果推送失败

| 报错 | 原因 | 怎么办 |
|---|---|---|
| `repository not found` | 仓库没建 / 名字写错 | 回去第 1 步确认仓库名 |
| `Authentication failed` | Token 错了或没勾 repo | 重新生成 Token，务必勾 repo |
| `could not connect` | 服务器连不上 GitHub | 改在你**自己电脑**上操作（见文末备选） |

---

## 第 4 步：跑编译（10 分钟，全自动）

1. 打开 `https://github.com/你的用户名/ddz`
2. 点顶部 **Actions**
3. 页面会提示「This workflow has a workflow_dispatch event」，点左侧列表里的 **编译安卓安装包**
4. 右侧点 **Run workflow** ▾
5. 填两个框：
   - `server_url`：`http://101.201.106.149:8080`
   - `app_name`：`PP斗地主`
6. 点绿色 **Run workflow** 按钮

然后会出现一条正在跑的记录，**点进去**能看实时日志。

**首次约 8~15 分钟**（要下载 Gradle 和 Android SDK）。看到绿色的 ✅ 就成功了。

---

## 第 5 步：下载 APK

1. 在那条成功的运行记录页面，拉到最底部
2. 找到 **Artifacts** 区域
3. 点 **ddz-apk** 下载（是个 zip）
4. 解压得到 **ddz.apk**

传到手机装就行。装时提示「未知来源」允许一次。

---

## 装好后的样子

- 图标：红底金边「**斗**」字
- 名字：**PP斗地主**
- 打开直接进 `http://101.201.106.149:8080`

---

## 备选：在你自己电脑上推代码

如果服务器连不上 GitHub，但你的**电脑能连**：

1. 把最新的 `ddz.zip` 下载到电脑，解压
2. 电脑上装 Git：https://git-scm.com/
3. 在解压出的 `ddz` 文件夹里右键 →「Git Bash Here」，执行：

```bash
git init
git add -A
git commit -m "斗地主"
git branch -M main
git remote add origin https://github.com/你的用户名/ddz.git
git push -u origin main
```

弹窗登录时，用户名填你的 GitHub 用户名，**密码框里粘贴 Token**（不是登录密码）。

然后回到第 4 步。

---

## 备选：完全不用命令行（网页上传）

1. 打开你的空仓库页面
2. 点 **uploading an existing file**（或 Add file → Upload files）
3. 把解压出来的 `ddz` 文件夹**整个拖进去**
   - ⚠️ 注意要包含 `.github` 文件夹（里面是编译配置）
   - 如果 `.github` 没传上去，Actions 页面不会出现工作流
4. 拉到底点 **Commit changes**
5. 回到第 4 步

> 网页上传有时会在资源管理器里隐藏以 `.` 开头的文件夹。
> 上传后在仓库首页确认能看到 `.github` 这个目录，看不到就说明没传成功。

---

## 常见问题

### Actions 页面看不到「编译安卓安装包」

说明 `.github/workflows/build-apk.yml` 没传上去。
回仓库首页确认有 `.github` 目录 → `workflows` → `build-apk.yml`。

### 编译失败（红色 ❌）

点进失败记录，展开红色那一步看日志。
最常见是 `npm install` 失败或 Gradle 超时，**直接重跑一次**（点 Re-run jobs）通常就好。

### 想换服务器地址重新打包

不用改代码，回到第 4 步，重新 Run workflow，填新地址即可。
