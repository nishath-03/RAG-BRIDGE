# ⬡ RAG-BRIDGE

> Real-time hybrid Web App + Discord Voice Agent — BYOK RAG pipeline powered by Google Gemini, Deepgram STT, and Microsoft Edge TTS.

![Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20Next.js%20%7C%20Discord.js-red?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-white?style=flat-square)
![DB](https://img.shields.io/badge/database-none%20required-green?style=flat-square)

---

## 1. Problem Statement
In modern development workflows, teams spend significant time searching through project documentations, API guides, and codebases. Standard LLMs lack this proprietary context, while traditional RAG chat interfaces are restricted to web pages that require manual text entry. RAG-BRIDGE solves this by combining web UI chat with a hands-free Discord Voice channel assistant. Users can upload documentation in real-time, step into a voice room with teammates, ask questions aloud, and receive spoken AI answers sourced strictly from their uploaded documents, all with a zero-cost Bring-Your-Own-Key (BYOK) model.

## 2. Technology Stack
*   **Language**: JavaScript (Node.js & TypeScript)
*   **Frontend**: Next.js 14 (React) with CSS Modules
*   **Backend**: Node.js & Express.js
*   **Real-time Communication**: Socket.IO (WebSockets)
*   **Database**: None (Zero-database architecture). Uses an in-memory document parsing, indexing, and TF-IDF search map to process contexts.
*   **LLM API**: Google Gemini API (instantiated dynamically with the user's API Key)
*   **Speech Services**: Deepgram API (live WebSocket-based Speech-to-Text) & Microsoft Edge TTS (Text-to-Speech)
*   **Deployment Platforms**: Next.js on **Vercel** (Serverless) and Express server/Discord Bot on **Railway** (Persistent Node instance)

## 3. Architecture
RAG-BRIDGE uses a split frontend-backend layout to balance low-latency serverless rendering with persistent event listening.

*   **Frontend-Backend Sync**: The frontend (Next.js) connects to the backend (Express) using Socket.IO. When the user types or speaks, text events and state logs stream bi-directionally. REST APIs are used only for file uploads and room initialization.
*   **LLM & Prompt Engine**: The backend interacts with the Gemini API. When a query comes in, the server compiles the prompt using the dynamically retrieved document context chunks, wraps it with custom system prompts, and calls the Google Generative AI SDK using the user's key.
*   **In-Memory Storage**: Room sessions, uploaded files, and TF-IDF text indices are stored inside a global `activeSessions` Javascript Map object. All uploads are deleted or wiped on server restarts, maintaining total security.

```
┌─────────────────────────────────┐
│        Next.js Frontend         │ (Vercel)
└────────────────┬────────────────┘
                 │
             Socket.IO (WebSocket)
                 │
                 ▼
┌─────────────────────────────────┐
│         Express Server          │ (Railway)
│  ┌───────────────────────────┐  │
│  │     activeSessions{}      │  │
│  │ (In-Memory Room Sessions) │  │
│  └─────────────┬─────────────┘  │
└────────────────┼────────────────┘
                 │
                 ├───────────────────────────────┐
                 ▼                               ▼
    ┌──────────────────────────┐    ┌──────────────────────────┐
    │       Discord Bot        │    │       RAG Engine         │
    │   (discord.js/voice)     │    │  (TF-IDF / Cosine Sim)   │
    └──────┬────────────┬──────┘    └──────────────────────────┘
           │            │
           ▼            ▼
     Deepgram STT   Edge-TTS
```

## 4. Workflow
1.  **Document Upload**: The user drops files (`.pdf`, `.txt`, `.py`, `.js`, etc.) into the Next.js UI. The files are uploaded to the Express server, chunked into blocks, vectorized using a custom TF-IDF calculation, and stored in-memory.
2.  **Voice Query Ingest**: When a speaker in the paired Discord channel talks, the bot pipes raw PCM audio stream packets to Deepgram's live WebSocket API.
3.  **Transcription & RAG**: Deepgram returns a text transcription. The server routes this transcript to the custom RAG engine, which performs a cosine similarity lookup against all document chunks in that room to find the top-k relevant fragments.
4.  **Inference & Playback**: The server injects the context chunks into the Gemini prompt template, calls the Gemini model, and receives the response. The text is sent to the Next.js UI terminal via Socket.IO, and concurrently converted into speech via Edge TTS to play into the Discord voice channel.

## 5. Prompt Engineering
RAG-BRIDGE dynamically adjusts its system prompting depending on the document contexts. For example, if it detects database schemas or SQL statements, it switches the model persona to a database engineer:

```javascript
function buildPrompt(question, contextChunks, systemPrompt) {
  const isSqlContext = detectSqlContext(contextChunks);
  const defaultSys = isSqlContext
    ? `You are an expert SQL data analyst and database engineer... Write correct, optimized SQL queries wrapped in triple-backtick sql blocks.`
    : `You are an expert AI knowledge assistant... Answer accurately using context. Cite specific chunks like [Chunk N].`;

  const sys = systemPrompt || defaultSys;
  const contextBlock = contextChunks.map((chunk, i) => `[Document Chunk ${i + 1}]\n${chunk}`).join('\n\n---\n\n');

  return `${sys}
=== DOCUMENT CONTEXT ===
${contextBlock}

=== USER QUESTION ===
${question}

=== RESPONSE INSTRUCTIONS ===
- Cite the sources. If information is missing, state it clearly.`;
}
```

## 6. Deployment
*   **Vercel**: Deploys the Next.js `/frontend` using settings declared in `vercel.json`.
*   **Railway**: Runs the `/server` directory containing the persistent Socket.IO server and Discord gateway listener, guided by `server/railway.json`.
*   **Docker Compose**: A root `docker-compose.yml` mounts a containerized environment locally, linking multi-stage Dockerfiles in the `/server` and `/frontend` folders.

---

## Quick Start

### 1. Clone & Install
```bash
npm install          # installs concurrently in root
cd server && npm install
cd ../frontend && npm install
```

### 2. Configure Environment
Create `server/.env`:
```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_id
DEEPGRAM_API_KEY=your_deepgram_key
PORT=3001
FRONTEND_URL=http://localhost:3000
```

### 3. Run Development Servers
```bash
npm run dev
```
Open `http://localhost:3000` to start creating workspaces.
