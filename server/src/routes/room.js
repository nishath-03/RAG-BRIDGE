'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();

const { createSession, getSessionSummary, sessionExists, removeFile, updateSessionConfig, getSession } = require('../sessionStore');
const { addChunks } = require('../sessionStore');
const { processFile } = require('../fileProcessor');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const webTts = new MsEdgeTTS();
let webTtsReady = false;

async function initWebTts() {
  try {
    await webTts.setMetadata('en-US-AriaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    webTtsReady = true;
    console.log('[Web TTS] Initialized for Web API.');
  } catch (err) {
    console.warn('[Web TTS] Initialization failed:', err.message);
  }
}
initWebTts();

// ─── Multer: memory storage (no disk writes) ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max per file
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/plain',
      'application/pdf',
      'application/javascript',
      'text/javascript',
      'application/x-python',
      'text/x-python',
      'text/x-java-source',
      'text/x-java',
      'application/octet-stream', // fallback for unknown types
    ];
    // Also allow by extension
    const allowedExts = [
      '.txt', '.js', '.ts', '.py', '.java', '.md', '.pdf',
      '.jsx', '.tsx',
      '.sql',          // SQL schemas and queries
      '.csv',          // CSV data files
      '.json',         // JSON data / configs
      '.yaml', '.yml', // YAML configs
      '.xml',          // XML data
    ];
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();

    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported: ${file.mimetype} (${file.originalname})`));
    }
  },
});

// ─── POST /api/room/create ───────────────────────────────────────────────────
// Body: { geminiKey: string }
// Returns: { roomId: string }
router.post('/create', (req, res) => {
  const { geminiKey } = req.body;

  if (!geminiKey || typeof geminiKey !== 'string' || geminiKey.trim().length < 10) {
    return res.status(400).json({ error: 'A valid Gemini API key is required.' });
  }

  const roomId = createSession(geminiKey.trim());

  // Emit sys log to any pre-existing web socket watchers
  if (global.io) {
    global.io.to(roomId).emit('sys_log', {
      type: 'SYS',
      message: `Room ${roomId} initialized. Upload documents to begin.`,
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(201).json({ roomId });
});

// ─── POST /api/room/:roomId/upload ───────────────────────────────────────────
// Multipart form: files[]
// Returns: { files: [{ name, chunkCount }], totalChunks: number }
router.post('/:roomId/upload', upload.array('files', 10), async (req, res) => {
  const { roomId } = req.params;

  if (!sessionExists(roomId)) {
    return res.status(404).json({ error: `Room ${roomId} does not exist.` });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const results = [];
  const errors = [];

  for (const file of req.files) {
    try {
      const chunks = await processFile(file.buffer, file.mimetype, file.originalname);
      addChunks(roomId, chunks, file.originalname);
      results.push({ name: file.originalname, chunkCount: chunks.length });

      if (global.io) {
        global.io.to(roomId).emit('file_processed', {
          name: file.originalname,
          chunkCount: chunks.length,
          timestamp: new Date().toISOString(),
        });
        global.io.to(roomId).emit('sys_log', {
          type: 'SYS',
          message: `Vectorized "${file.originalname}" → ${chunks.length} chunks indexed.`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      errors.push({ name: file.originalname, error: err.message });
      if (global.io) {
        global.io.to(roomId).emit('sys_log', {
          type: 'ERR',
          message: `Failed to process "${file.originalname}": ${err.message}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  const totalChunks = results.reduce((s, f) => s + f.chunkCount, 0);
  return res.status(200).json({ files: results, errors, totalChunks });
});

// ─── DELETE /api/room/:roomId/file ───────────────────────────────────────────
// Body: { fileName: string }
router.delete('/:roomId/file', (req, res) => {
  const { roomId } = req.params;
  const { fileName } = req.body;

  if (!sessionExists(roomId)) {
    return res.status(404).json({ error: `Room ${roomId} does not exist.` });
  }
  if (!fileName) {
    return res.status(400).json({ error: 'fileName is required.' });
  }

  try {
    removeFile(roomId, fileName);

    if (global.io) {
      global.io.to(roomId).emit('file_removed', {
        name: fileName,
        timestamp: new Date().toISOString(),
      });
      global.io.to(roomId).emit('sys_log', {
        type: 'SYS',
        message: `File "${fileName}" removed from index.`,
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({ success: true, message: `File "${fileName}" removed successfully.` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/room/:roomId/config ───────────────────────────────────────────
// Body: { model, topK, systemPrompt, geminiKey }
router.post('/:roomId/config', (req, res) => {
  const { roomId } = req.params;
  const { model, topK, systemPrompt, geminiKey } = req.body;

  if (!sessionExists(roomId)) {
    return res.status(404).json({ error: `Room ${roomId} does not exist.` });
  }

  try {
    const updates = {};
    if (model !== undefined) updates.model = model;
    if (topK !== undefined) updates.topK = parseInt(topK, 10);
    if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;
    if (geminiKey !== undefined && geminiKey.trim().length >= 10) updates.geminiKey = geminiKey.trim();

    updateSessionConfig(roomId, updates);

    const summary = getSessionSummary(roomId);
    const session = getSession(roomId);

    if (global.io) {
      global.io.to(roomId).emit('config_updated', {
        config: summary.config,
        hasGeminiKey: Boolean(session.geminiKey),
        timestamp: new Date().toISOString(),
      });
      global.io.to(roomId).emit('sys_log', {
        type: 'SYS',
        message: `Configuration updated: model=${summary.config.model}, topK=${summary.config.topK}.`,
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({ success: true, message: 'Configuration updated successfully.', config: summary.config });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/room/:roomId/status ────────────────────────────────────────────
router.get('/:roomId/status', (req, res) => {
  const { roomId } = req.params;
  const summary = getSessionSummary(roomId);
  if (!summary) {
    return res.status(404).json({ error: `Room ${roomId} does not exist.` });
  }
  return res.json(summary);
});

// ─── GET /api/room/tts ────────────────────────────────────────────────────────
router.get('/tts', async (req, res) => {
  const { text } = req.query;
  if (!text) {
    return res.status(400).json({ error: 'text query parameter is required.' });
  }

  try {
    if (!webTtsReady) {
      await initWebTts();
    }
    const { audioStream } = webTts.toStream(text);
    res.setHeader('Content-Type', 'audio/mpeg');
    audioStream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Multer error handler ─────────────────────────────────────────────────────
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError || err.message?.includes('not supported')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('[Room Router Error]', err);
  return res.status(500).json({ error: 'Internal server error.' });
});

module.exports = router;
