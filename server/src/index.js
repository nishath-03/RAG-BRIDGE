'use strict';
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const roomRoutes = require('./routes/room');
const { initDiscordBot } = require('./discordBot');
const { getSession } = require('./sessionStore');
const { query: ragQuery } = require('./ragEngine');
const { generateResponse, AuthError } = require('./geminiClient');

const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Build an allowlist: the configured FRONTEND_URL + any Vercel preview URLs
const ALLOWED_ORIGINS = [
  FRONTEND_URL,
  'http://localhost:3000',
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // allow server-to-server requests
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow all Vercel preview deployments (*.vercel.app)
  if (/\.vercel\.app$/.test(origin)) return true;
  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) callback(null, true);
    else callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST'],
};

// ─── Express App ────────────────────────────────────────────────────────────
const app = express();
const httpServer = http.createServer(app);

// ─── Socket.IO ──────────────────────────────────────────────────────────────
const io = new Server(httpServer, { cors: corsOptions });

// Export io so other modules can emit events
global.io = io;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/room', roomRoutes);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ─── Socket.IO Connection ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    console.log(`[WS] Socket ${socket.id} joined room ${roomId}`);
    socket.emit('sys_log', {
      type: 'SYS',
      message: `Workspace ready. Type a question below, or optionally pair Discord voice with !connect ${roomId}`,
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Web Chat Query (no Discord required) ──────────────────────────
  socket.on('web_query', async ({ roomId, question }) => {
    if (!roomId || !question?.trim()) return;

    const session = getSession(roomId);
    if (!session) {
      socket.emit('sys_log', { type: 'ERR', message: `Room ${roomId} not found.`, timestamp: new Date().toISOString() });
      return;
    }

    // Echo user message back to terminal
    io.to(roomId).emit('transcript', {
      type: 'USER',
      message: question.trim(),
      timestamp: new Date().toISOString(),
    });

    try {
      const contextChunks = ragQuery(roomId, question.trim(), 3);
      const answer = await generateResponse({
        apiKey: session.geminiKey,
        question: question.trim(),
        contextChunks,
        modelName: session.config?.model,
        systemPrompt: session.config?.systemPrompt,
      });

      io.to(roomId).emit('bot_response', {
        type: 'BOT',
        message: answer,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof AuthError) {
        const alertMsg = 'Authentication Failure: Please refresh your Gemini API key inside the room settings console.';
        io.to(roomId).emit('auth_error', { type: 'ERR', message: alertMsg, timestamp: new Date().toISOString() });
      } else {
        io.to(roomId).emit('sys_log', { type: 'ERR', message: `Error: ${err.message}`, timestamp: new Date().toISOString() });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ─── Discord Bot ─────────────────────────────────────────────────────────────
if (process.env.DISCORD_TOKEN) {
  initDiscordBot().catch((err) => {
    console.error('[Discord] Failed to initialize bot:', err.message);
  });
} else {
  console.warn('[Discord] DISCORD_TOKEN not set. Bot will not start.');
}

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🔴 RAG-BRIDGE`);
  console.log(`   Server   → http://localhost:${PORT}`);
  console.log(`   Frontend → ${FRONTEND_URL}\n`);
});

module.exports = { app, io };
