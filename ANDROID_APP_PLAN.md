
# 安卓 App 开发方案

## 📱 技术选型：Capacitor

### 为什么选 Capacitor？
- ✅ **直接复用现有 Web 代码**，不需要重写
- ✅ **开发速度最快**
- ✅ **配置简单**
- ✅ 可以打包成真正的 APK

---

## 📋 功能需求

### 1. 服务器地址可配置
- App 启动时显示配置界面
- 用户输入 ngrok/natapp/frp 地址
- 地址保存到本地存储
- 下次打开自动连接

### 2. 复用现有功能
- 聊天界面
- WebSocket 连接
- 所有现有功能

---

## 🗂️ 项目结构

```
vibe-bridge/
├── client/              # 现有前端代码（复用）
├── server/              # 现有后端
├── android/             # 新建：安卓平台代码
└── capacitor.config.ts  # 新建：Capacitor 配置
```
