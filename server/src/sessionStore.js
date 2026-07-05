'use strict';

/**
 * In-memory session store.
 * activeSessions[roomId] = {
 *   geminiKey: string,
 *   chunks: Array<{ text: string, tfidf: object }>,
 *   voiceChannelId: string | null,
 *   guildId: string | null,
 *   files: Array<{ name: string, chunkCount: number }>,
 *   createdAt: Date,
 * }
 */
const activeSessions = {};

/**
 * Generate a cryptographically random 6-digit alphanumeric Room ID.
 */
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // exclude ambiguous chars
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  // Ensure uniqueness
  if (activeSessions[id]) return generateRoomId();
  return id;
}

/**
 * Create a new session for the given Gemini API key.
 * @returns {string} The new 6-digit Room ID.
 */
function createSession(geminiKey) {
  const roomId = generateRoomId();
  activeSessions[roomId] = {
    geminiKey,
    chunks: [],
    voiceChannelId: null,
    guildId: null,
    files: [],
    createdAt: new Date(),
    config: {
      model: 'gemini-2.5-flash',
      topK: 3,
      systemPrompt: 'You are a helpful AI assistant. Use the following document context to answer the user\'s question.'
    }
  };
  console.log(`[Session] Created room ${roomId}`);
  return roomId;
}

/**
 * Retrieve a session by Room ID. Returns null if not found.
 */
function getSession(roomId) {
  return activeSessions[roomId] || null;
}

/**
 * Check whether a given Room ID exists.
 */
function sessionExists(roomId) {
  return Boolean(activeSessions[roomId]);
}

/**
 * Append vectorized text chunks to a session.
 * @param {string} roomId
 * @param {Array<{ text: string, tokens: string[] }>} chunks
 * @param {string} fileName
 */
function addChunks(roomId, chunks, fileName) {
  const session = activeSessions[roomId];
  if (!session) throw new Error(`Room ${roomId} not found`);

  // Tag chunks with the file name to support file deletion later
  const chunksWithFile = chunks.map(chunk => ({
    ...chunk,
    fileName
  }));

  session.chunks.push(...chunksWithFile);
  session.files.push({ name: fileName, chunkCount: chunks.length });
  console.log(`[Session] Room ${roomId}: added ${chunks.length} chunks from "${fileName}"`);
}

/**
 * Remove a file and its chunks from the room session.
 */
function removeFile(roomId, fileName) {
  const session = activeSessions[roomId];
  if (!session) throw new Error(`Room ${roomId} not found`);

  session.chunks = session.chunks.filter(chunk => chunk.fileName !== fileName);
  session.files = session.files.filter(file => file.name !== fileName);
  console.log(`[Session] Room ${roomId}: removed file "${fileName}"`);
}

/**
 * Update the session settings/configuration.
 */
function updateSessionConfig(roomId, configUpdates) {
  const session = activeSessions[roomId];
  if (!session) throw new Error(`Room ${roomId} not found`);

  session.config = {
    ...session.config,
    ...configUpdates
  };

  if (configUpdates.geminiKey) {
    session.geminiKey = configUpdates.geminiKey;
  }
  console.log(`[Session] Room ${roomId}: updated configuration`);
}

/**
 * Map a Discord voice channel to a room session.
 */
function updateSessionVoiceChannel(roomId, voiceChannelId, guildId) {
  const session = activeSessions[roomId];
  if (!session) throw new Error(`Room ${roomId} not found`);
  session.voiceChannelId = voiceChannelId;
  session.guildId = guildId;
  console.log(`[Session] Room ${roomId}: mapped to voice channel ${voiceChannelId}`);
}

/**
 * Return a sanitized summary of a session (no API key exposed).
 */
function getSessionSummary(roomId) {
  const session = activeSessions[roomId];
  if (!session) return null;
  return {
    roomId,
    files: session.files,
    chunkCount: session.chunks.length,
    voiceChannelId: session.voiceChannelId,
    createdAt: session.createdAt,
    hasGeminiKey: Boolean(session.geminiKey),
    config: session.config
  };
}

/**
 * Delete a session.
 */
function deleteSession(roomId) {
  delete activeSessions[roomId];
}

module.exports = {
  activeSessions,
  createSession,
  getSession,
  sessionExists,
  addChunks,
  removeFile,
  updateSessionConfig,
  updateSessionVoiceChannel,
  getSessionSummary,
  deleteSession,
};
