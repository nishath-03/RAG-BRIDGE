# ⬡ RAG-BRIDGE

> Real-time hybrid Web App + Discord Voice Agent — BYOK RAG pipeline powered by Google Gemini, Deepgram STT, and Microsoft Edge TTS.

![Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20Next.js%20%7C%20Discord.js-red?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-white?style=flat-square)
![DB](https://img.shields.io/badge/database-none%20required-green?style=flat-square)

---

## Architecture

```
Web App (Next.js :3000) ◄── Socket.IO ──► Server (Express :3001)
                                                     │
                                          ┌──────────┴──────────┐
                                          │  activeSessions{}   │
                                          │  (in-memory map)    │
                                          └──────────┬──────────┘
                                                     │
                                          Discord Bot (discord.js)
                                               │          │
                                          Deepgram      Edge-TTS
                                           (STT)        (voice out)
```

---

## Quick Start

### 1. Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 |
| npm | ≥ 9 |

### 2. Clone & Install

```bash
cd y:\RAG_AGENT
npm install          # installs concurrently in root
cd server && npm install
cd ../frontend && npm install
```

### 3. Configure Environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_id
DEEPGRAM_API_KEY=your_deepgram_key
PORT=3001
FRONTEND_URL=http://localhost:3000
```

#### Getting Your Keys

| Key | Where to get it |
|-----|----------------|
| **Discord Bot Token** | [discord.com/developers](https://discord.com/developers/applications) → New Application → Bot → Reset Token |
| **Discord Client ID** | Same page → General Information → Application ID |
| **Deepgram API Key** | [deepgram.com](https://console.deepgram.com) → Create API Key (free $200 credit) |
| **Gemini API Key** | [aistudio.google.com](https://aistudio.google.com/app/apikey) → entered per room in the web UI |

#### Discord Bot Permissions Required

In the Discord Developer Portal, under **Bot**, enable:
- ✅ `Message Content Intent`
- ✅ `Server Members Intent`

**OAuth2 Scopes:** `bot`, `applications.commands`
**Bot Permissions:** `Send Messages`, `Connect`, `Speak`, `Use Voice Activity`

### 4. Run Development Servers

```bash
# From y:\RAG_AGENT root — runs both in parallel
npm run dev

# Or separately:
npm run dev:server    # Express server on :3001
npm run dev:frontend  # Next.js on :3000
```

---

## Usage Flow

### 1. Web App — Create a Room

1. Open `http://localhost:3000`
2. Click **Initialize Workspace**
3. Upload documents (`.txt`, `.js`, `.py`, `.java`, `.ts`, `.pdf`, `.md`)
4. Paste your **Google Gemini API Key**
5. Click **Deploy Room** → a 6-digit **Room ID** appears
6. The workspace opens with live terminal + document manager

### 2. Discord Bot — Connect to Voice

1. Join a Discord voice channel
2. In any text channel, type:
   ```
   !connect ABC123
   ```
   *(replace `ABC123` with your Room ID)*
3. The bot joins the voice channel and maps it to your room

### 3. Live Q&A

- **Speak** your question in the Discord voice channel
- The bot transcribes via Deepgram, retrieves context from your documents, queries Gemini
- The answer **streams to your web terminal** + the bot **speaks back** via Edge-TTS
- If the bot is mid-speech and you start talking, it **stops and listens immediately**

---

## Project Structure

```
y:\RAG_AGENT\
├── package.json              ← root (npm workspaces + concurrently)
├── server/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── index.js          ← Express + Socket.IO entry
│       ├── sessionStore.js   ← In-memory room map
│       ├── fileProcessor.js  ← PDF/text chunker
│       ├── ragEngine.js      ← TF-IDF cosine similarity search
│       ├── geminiClient.js   ← BYOK Gemini gateway
│       ├── discordBot.js     ← Full Discord voice engine
│       └── routes/
│           └── room.js       ← REST API: create/upload/status
└── frontend/
    ├── package.json
    ├── next.config.js
    └── app/
        ├── layout.tsx
        ├── page.tsx          ← 3-state view machine
        ├── globals.css       ← Design system tokens
        └── components/
            ├── LandingView.tsx      ← ASCII logo + typewriter
            ├── SetupView.tsx        ← File drop + API key
            ├── WorkspaceView.tsx    ← Socket.IO + split pane
            ├── DocumentManager.tsx  ← Left pane: file chunks
            └── TerminalLog.tsx      ← Right pane: live log
```

---

## API Reference

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/room/create` | POST | `{ geminiKey }` | Create room, returns `{ roomId }` |
| `/api/room/:id/upload` | POST | `FormData (files[])` | Upload & vectorize files |
| `/api/room/:id/status` | GET | — | Room metadata |
| `/health` | GET | — | Server health |

### Socket.IO Events (server → client)

| Event | Payload | Description |
|-------|---------|-------------|
| `sys_log` | `{ type, message, timestamp }` | System messages |
| `transcript` | `{ type, message, timestamp }` | User voice transcript |
| `bot_response` | `{ type, message, timestamp }` | Gemini answer |
| `auth_error` | `{ type, message, timestamp }` | Gemini key error |
| `file_processed` | `{ name, chunkCount }` | File vectorization done |

---

## Security Notes

- Gemini API keys are **never logged** or persisted — stored only in the in-memory `activeSessions` map
- The session summary endpoint (`/status`) explicitly omits the API key
- All sessions are **lost on server restart** (by design — zero persistence)
- CORS is restricted to `FRONTEND_URL` only
