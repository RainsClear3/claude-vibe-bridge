# Claude Anywhere

[中文版](README.md)

> A web-based interface for **Claude Desktop 3P (Third-party API mode)**. Remotely control Claude Desktop's coding agent from your phone or any browser, with real-time streaming responses and tool approval flow.

**What is Claude Desktop 3P?** Claude Desktop has a "third-party API" mode that exposes `claude.exe` CLI with streaming JSON output. This project wraps that CLI into a Web server + PWA, letting you chat with Claude's coding agent from your phone while it works on your PC.

## Architecture

```
Phone/Browser ──WebSocket──> Server (Express) ──spawn──> claude.exe (Claude Desktop 3P)
   (PWA)        streaming       (port 3900)    stdin/out      (coding agent)
```

- **Server** spawns `claude.exe` with `--output-format stream-json` and relays messages over WebSocket
- **Client** is a PWA that renders conversations in real-time
- Sessions are stored in Claude Desktop's own session directory — no data duplication
- **No API key needed** — authentication is handled by Claude Desktop itself

## Screenshots

| Server Configuration | Session List | Chat Interface |
|:---:|:---:|:---:|
| ![Server Configuration](png/服务器配置.png) | ![Session List](png/会话栏.png) | ![Chat](png/对话.png) |

## Prerequisites

- **Windows** with [Claude Desktop](https://claude.ai/download) installed
- Claude Desktop must have **3P mode enabled** (Settings > Developer > Third-party API)
- **Node.js 18+**
- [cc-switch](https://github.com/farion1231/cc-switch) for managing third-party API configurations. cc-switch is a cross-platform desktop app that lets you manage multiple API providers in one place and switch between them with a single click. When switching, cc-switch automatically writes the corresponding `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, etc. into the `env` field of `~/.claude/settings.json`. `claude.exe` reads this file at startup to connect to the third-party API. This project does not modify this configuration file — it relies on cc-switch for config management.

  Key environment variables in `~/.claude/settings.json`:

  ```json
  {
    "env": {
      "ANTHROPIC_BASE_URL": "https://your-api-provider.com",
      "ANTHROPIC_AUTH_TOKEN": "your-api-key",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "your-model-name",
      "ANTHROPIC_DEFAULT_SONNET_1M_MODEL": "your-model-name[1M]",
      "ANTHROPIC_DEFAULT_OPUS_MODEL": "your-model-name-pro",
      "ANTHROPIC_DEFAULT_OPUS_1M_MODEL": "your-model-name-pro[1M]",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "your-model-name-lite",
      "ANTHROPIC_DEFAULT_HAIKU_1M_MODEL": "your-model-name-lite[1M]"
    }
  }
  ```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure (copy and edit)
cp .env.example .env

# 3. Start
npm run dev:server    # Server runs on http://localhost:3900
```

Open `http://localhost:3900` or `https://your-ip:3900` in any browser. The server auto-discovers your Claude Desktop installation.

### Production Build

```bash
cd client && npx vite build    # Builds to client/dist
cd .. && npx tsx server/src/index.ts    # Server serves client/dist
```

## Configuration

All configuration is in `.env` (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ENABLED` | `false` | Enable HTTP Basic Auth |
| `AUTH_USERNAME` | | Login username |
| `AUTH_PASSWORD` | | Login password |
| `PORT` | `3900` | Server port |
| `ALLOWED_DIRS` | `%USERPROFILE%` | Pipe-separated directories the agent can access |
| `CLAUDE_DESKTOP_USER_ID` | auto-discovered | Override if multiple accounts exist |
| `CLAUDE_DESKTOP_APP_ID` | auto-discovered | Override if multiple accounts exist |

> Claude Desktop paths (user ID, app ID, CLI location) are **auto-discovered** at startup. Manual configuration is rarely needed.

## Features

- **Real-time streaming** — thinking blocks, text, tool use/results arrive live
- **Thread-based sessions** — resumes existing Claude Desktop conversations
- **Tool approval** — optionally require browser approval for file writes and commands
- **Model & effort selector** — switch between Opus/Sonnet/Haiku and effort levels
- **Markdown rendering** — tables, code blocks, headers, lists, links
- **5 themes** — Deep Sea, Light, Cyberpunk, Minimal, Forest
- **PWA** — installable on mobile, works as a standalone app
- **Authentication** — HTTP Basic Auth for both HTTP and WebSocket
- **Skill support** — type `/skill-name` to inject Claude Desktop skills
- **Android app** — Capacitor wrapper for native Android (see `android/`)

## Android App

The project includes a Capacitor-based Android app:

```bash
cd client && npx vite build    # Build web assets
npx cap sync android           # Sync to Android project
# Open android/ in Android Studio to build APK
```

The Android app auto-detects the server URL. For remote servers, it shows a configuration screen on first launch.

## Network Access (ngrok / frp)

To access from outside your local network, see `frp/ngrok.md` or `frp/DEPLOY.md` for tunneling setup with ngrok, frp, or natapp.

## Project Structure

```
├── client/          # Vanilla TypeScript PWA (Vite)
│   └── src/
│       ├── components/    # status-bar, input-bar
│       ├── views/         # chat-view, thread-list
│       ├── state/         # reactive store
│       ├── services/      # WebSocket client
│       └── styles/        # CSS themes
├── server/          # Express + WebSocket server
│   └── src/
│       ├── agent/         # CLI runner (spawns claude.exe)
│       ├── session/       # thread persistence
│       └── ws/            # WebSocket handler
├── shared/          # Protocol & session types
├── android/         # Capacitor Android project
└── frp/             # Network tunneling guides
```

## License

MIT
