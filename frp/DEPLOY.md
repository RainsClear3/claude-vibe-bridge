
# Claude Vibe Bridge 内网穿透部署指南

## 方案概览

使用 frp + 国内云服务器实现手机与电脑任意位置互通。

## 一、准备工作

### 1.1 购买云服务器

推荐购买：
- 阿里云轻量应用服务器：https://www.aliyun.com/product/swas
- 腾讯云轻量应用服务器：https://cloud.tencent.com/product/lighthouse

配置建议：
- CPU: 2核
- 内存: 2GB
- 带宽: 3Mbps+
- 系统: Ubuntu 22.04 LTS
- 价格: 约 50-100 元/月

### 1.2 下载 frp

下载地址：https://github.com/fatedier/frp/releases

下载对应版本：
- 云服务器：`frp_x.x.x_linux_amd64.tar.gz`
- Windows电脑：`frp_x.x.x_windows_amd64.zip`

## 二、云服务器端（frps）配置

### 2.1 上传并解压 frp

```bash
# 在云服务器上
tar -zxvf frp_x.x.x_linux_amd64.tar.gz
cd frp_x.x.x_linux_amd64
```

### 2.2 上传配置文件

将 `frps.toml` 上传到云服务器 frp 目录，然后修改：
- `webServer.password`: 设置一个强密码
- `auth.token`: 设置一个认证令牌（字符串即可）

### 2.3 配置云服务器防火墙

在云服务器控制台开放以下端口：
- 7000 (frp 服务端口)
- 3900 (vibe-bridge 服务端口)
- 7500 (frp 管理面板，可选)

### 2.4 启动 frps

```bash
# 前台运行（测试用）
./frps -c frps.toml

# 后台运行（推荐）
nohup ./frps -c frps.toml &gt; frps.log 2&gt;&amp;1 &amp;
```

### 2.5 （可选）设置为系统服务，开机自启

创建 `/etc/systemd/system/frps.service`：

```ini
[Unit]
Description=frp server
After=network.target

[Service]
Type=simple
User=root
Restart=on-failure
RestartSec=5s
ExecStart=/path/to/frps -c /path/to/frps.toml

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
systemctl daemon-reload
systemctl enable frps
systemctl start frps
systemctl status frps
```

## 三、内网电脑端（frpc）配置

### 3.1 解压 frp

解压下载的 Windows 版本 frp。

### 3.2 修改配置文件

编辑 `frpc.toml`：
- `serverAddr`: 改为你的云服务器公网 IP
- `auth.token`: 与 frps 保持一致

### 3.3 启动 frpc

双击运行（或命令行）：

```cmd
frpc -c frpc.toml
```

### 3.4 （可选）Windows 开机自启

使用「任务计划程序」或 nssm 工具设置开机自启。

## 四、启动 Vibe Bridge

在内网电脑上正常启动你的 Claude Vibe Bridge：

```bash
npm run dev:server
```

## 五、手机访问

在手机浏览器打开：

```
http://你的云服务器IP:3900
```

搞定！现在你可以在国内任何地方用手机访问了。

## 六、安全建议

1. **修改默认密码和 token**，不要用示例中的值
2. （可选）配置 frp 的 `transport.tls` 启用加密
3. （可选）配置云服务器安全组，只允许你的 IP 访问管理面板 7500
4. （可选）使用 HTTPS（需要域名和证书）

## 故障排查

- 检查云服务器防火墙端口是否开放
- 检查 frps 和 frpc 日志
- 确认 vibe-bridge 是否在本地正常运行
- 访问 http://云服务器IP:7500 查看 frp 管理面板

