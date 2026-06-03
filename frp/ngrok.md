
# Ngrok 快速上手指南

## 5 分钟快速开始

### 1. 注册并下载

1. 访问 https://ngrok.com/ 注册账号
2. 登录后访问 https://dashboard.ngrok.com/get-started/setup
3. 下载 Windows 版本 ngrok

### 2. 配置认证

解压 ngrok，在命令行运行：

```bash
ngrok config add-authtoken 你的token_here
```

（token 在 ngrok 后台可以找到）

### 3. 启动你的 Vibe Bridge

```bash
npm run dev:server
```

### 4. 启动 ngrok 隧道

```bash
ngrok http 3900
```

### 5. 手机访问

ngrok 会显示一个公网地址，例如：
```
Forwarding  https://xyz.ngrok-free.dev -&gt; http://localhost:3900
```

在手机浏览器打开这个地址即可！

## 注意事项

- 免费版每次重启 ngrok，域名都会变
- 国外服务器，国内速度可能一般
- 适合快速测试验证

