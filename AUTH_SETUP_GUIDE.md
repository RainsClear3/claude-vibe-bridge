
# Claude Vibe Bridge 认证功能设置指南

## 🔐 认证功能已启用！

恭喜！你的 Claude Vibe Bridge 现在受密码保护了！

---

## 📝 默认登录信息

| 项目 | 值 |
|------|-----|
| 用户名 | `admin` |
| 密码 | （请查看你的 `.env` 文件） |

⚠️ **请务必修改默认密码！**

---

## 🚀 如何使用

### 1. 重启服务器
（如果服务器正在运行，需要重启以加载新的 .env 配置）

### 2. 访问服务
打开浏览器访问，会弹出登录框，输入用户名密码即可！

通过 ngrok 访问时：`https://your-ngrok-url.ngrok-free.dev`

---

## 🔧 如何修改密码

编辑项目根目录下的 `.env` 文件：

```env
AUTH_ENABLED=true
AUTH_USERNAME=your_username
AUTH_PASSWORD=your_secure_password
```

修改后重启服务器生效！

---

## 🛡️ 安全建议

1. **使用强密码**：不要使用 123456、password 等简单密码
2. **保护 .env 文件**：不要把 .env 文件提交到 git
3. **考虑 HTTPS**：如果用 frp + 自己的服务器，建议配置 HTTPS 加密传输
4. **定期更换密码**：定期更新访问密码

---

## ❌ 如何关闭认证

如果不需要认证，在 `.env` 中设置：

```env
AUTH_ENABLED=false
```

---

## 📁 修改的文件

| 文件 | 说明 |
|------|------|
| `server/src/config.ts` | 添加认证配置 |
| `server/src/index.ts` | 添加认证中间件 |
| `server/src/ws/server.ts` | 添加 WebSocket 认证 |
| `.env` | 认证配置（新建） |
| `.env.example` | 配置示例（新建） |
