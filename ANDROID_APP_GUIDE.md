# Claude Vibe Bridge Android App 使用指南

## 📱 App 功能完成！

你的 Claude Vibe Bridge Android App 已经准备好了！

---

## ✅ 已完成功能

### 1. 服务器地址可配置
- 首次打开 App 时会显示配置界面
- 输入 ngrok/natapp/frp 地址后保存
- 地址保存在本地，下次自动连接
- 随时可以在侧边栏点击「⚙️ 设置」修改地址

### 2. 完整聊天界面
- 所有现有功能完全保留
- 实时 WebSocket 连接
- 会话管理等

---

## 🚀 如何构建和安装

### 前置要求
- Android Studio (最新稳定版)
- JDK 17+
- Android SDK (API 26+)

### 方式一：使用 Android Studio 构建
1. 打开 Android Studio
2. 打开项目：选择 `android` 目录
3. 等待 Gradle 同步完成
4. 连接 Android 设备或启动模拟器
5. 点击「▶️ Run」按钮

### 方式二：命令行构建 APK
```bash
# 进入 Android 目录
cd android

# 构建 Debug APK
./gradlew assembleDebug

# 构建 Release APK (需要签名)
./gradlew assembleRelease
```

APK 位置：
- Debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `android/app/build/outputs/apk/release/app-release.apk`

---

## 🔄 同步代码变更

如果你修改了前端代码，需要重新构建并同步：

```bash
# 1. 重新构建前端
npm run build:client

# 2. 同步到 Android 项目
npx cap sync android

# 3. (可选) 打开 Android Studio
npx cap open android
```

---

## 💡 使用提示

### 1. 首次使用
1. 启动你的 Claude Vibe Bridge 服务器
2. 启动 ngrok/natapp/frp 内网穿透
3. 在手机上打开 App
4. 输入公网地址（如 `https://xxx.ngrok-free.dev`）
5. 点击「保存并连接」
6. 开始使用！

### 2. 更换服务器地址
- 点击侧边栏「⚙️ 设置」
- 或点击顶部状态栏右侧的「⚙️」
- 输入新地址并保存

### 3. 局域网直连
如果你电脑和手机在同一 Wi-Fi 下，可以直接用：
- `http://192.168.x.x:3900`

---

## 📁 项目结构

```
vibe-bridge/
├── client/           # 前端 (已包含服务器配置功能)
├── server/           # 后端服务
├── android/          # ⭐ Android 平台项目 (新增)
├── capacitor.config.ts # Capacitor 配置
└── ...
```

---

## 🛡️ 安全提示

1. **不要把 .env 提交到 Git**
   - 里面有密码等敏感信息

2. **如果长期使用**
   - 建议使用 frp + 自己的云服务器
   - 更稳定，更可控

3. **Android 权限**
   - App 只需要 INTERNET 权限
   - 没有其他敏感权限

---

## 🎯 下一步

现在你可以：
1. 用 Android Studio 打开 `android` 目录
2. 构建 APK 并安装到手机
3. 测试内网穿透和服务器配置功能
4. 享受随时随地使用 Claude Vibe Bridge！
