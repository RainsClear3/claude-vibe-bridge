# Claude Vibe Bridge

A mobile-first PWA that bridges web browsers to Claude Desktop via WebSocket, enabling AI-powered coding from your phone.

## Architecture

```
Phone/Browser  ──WebSocket──>  Server (Express)  ──spawn──>  Claude Desktop CLI
   (PWA)         streaming         (port 3900)      stdin/out      (claude.exe)
```

- **client** — Vanilla TypeScript PWA with Vite (no framework)
- **server** — Express + WebSocket server, spawns Claude Desktop's CLI process
- **shared** — Protocol types, session models, Anthropic API types

## Quick Start

```bash
# Install dependencies
npm install

# Start server (port 3900)
npm run dev:server

# Start client dev server (port 3901, proxies /ws to 3900)
npm run dev:client
```

Open `http://localhost:3901` in your browser.

### Production

```bash
npm run build:client   # builds to client/dist
npm run dev:server     # server serves client/dist on port 3900
```

## Features

- **Real-time streaming** — thinking blocks, text, tool use/results arrive live
- **Thread-based sessions** — multiple conversations with persistent history
- **Tool approval flow** — approve or deny tool executions from the browser
- **5 themes** — Deep Sea (default), Light, Cyberpunk, Minimal, Forest
- **PWA** — installable on mobile, service worker for offline shell
- **Responsive** — mobile sidebar overlay, safe area insets

## Configuration

Create a `.env` file in the project root:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

Server config (port, allowed directories, default model) is in `server/src/config.ts`.

## Project Structure

```
├── client/
│   ├── src/
│   │   ├── components/     # status-bar, input-bar
│   │   ├── views/          # chat-view, thread-list
│   │   ├── state/          # reactive store
│   │   ├── services/       # WebSocket client
│   │   └── styles/         # CSS variables, themes
│   └── public/             # manifest, service worker, logo
├── server/
│   └── src/
│       ├── agent/          # CLI runner, executor, tool definitions
│       ├── api/            # Anthropic client (direct API)
│       ├── session/        # thread/turn persistence
│       └── ws/             # WebSocket handler, broadcast
└── shared/
    └── src/                # protocol, session types, API models
```

## License

MIT
