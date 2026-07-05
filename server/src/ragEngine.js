'use strict';

const { getSession } = require('./sessionStore');

/**
 * Compute the dot product of two term-frequency maps.
 */
function dotProduct(vecA, vecB) {
  let sum = 0;
  for (const [term, freq] of Object.entries(vecA)) {
    if (vecB[term]) sum += freq * vecB[term];
  }
  return sum;
}

/**
 * Compute the L2 magnitude of a term-frequency map.
 */
function magnitude(vec) {
  return Math.sqrt(Object.values(vec).reduce((s, v) => s + v * v, 0));
}

/**
 * Cosine similarity between two TF vectors (plain objects: term → freq).
 */
function cosineSimilarity(vecA, vecB) {
  const magA = magnitude(vecA);
  const magB = magnitude(vecB);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(vecA, vecB) / (magA * magB);
}

/**
 * Build a simple term-frequency vector from an array of tokens.
 */
function buildTfVector(tokens) {
  const vec = {};
  for (const token of tokens) {
    const t = token.toLowerCase();
    vec[t] = (vec[t] || 0) + 1;
  }
  return vec;
}

/**
 * Query the in-memory vector store for the most relevant chunks.
 *
 * @param {string}   roomId   Room session to query
 * @param {string}   question User's question text
 * @param {number}   topK     Number of top chunks to return (default 3)
 * @returns {string[]}        Array of most relevant text chunks, best first
 */
function query(roomId, question, topK = 3) {
  const session = getSession(roomId);
  if (!session) throw new Error(`Room ${roomId} not found`);
  if (session.chunks.length === 0) return [];

  const limit = (session.config && typeof session.config.topK === 'number')
    ? session.config.topK
    : topK;

  // Build query vector
  const queryTokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const queryVec = buildTfVector(queryTokens);

  // Score each chunk
  const scored = session.chunks.map((chunk) => {
    const chunkVec = buildTfVector(chunk.tokens);
    return {
      text: chunk.text,
      score: cosineSimilarity(queryVec, chunkVec),
    };
  });

  // Sort descending by score and return topK texts
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter((c) => c.score > 0)
    .map((c) => c.text);
}

module.exports = { query };
