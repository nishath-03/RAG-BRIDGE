'use strict';

const pdfParse = require('pdf-parse');
const natural = require('natural');

const CHUNK_SIZE = 500;    // target tokens per chunk
const CHUNK_OVERLAP = 50;  // overlap tokens between chunks

/**
 * Tokenize text into words (simple whitespace split).
 */
function tokenize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Split tokens into overlapping windows of CHUNK_SIZE.
 * @param {string[]} tokens
 * @returns {string[]} Array of chunk strings
 */
function chunkTokens(tokens) {
  const chunks = [];
  let start = 0;
  while (start < tokens.length) {
    const slice = tokens.slice(start, start + CHUNK_SIZE);
    chunks.push(slice.join(' '));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
    if (slice.length < CHUNK_SIZE) break;
  }
  return chunks;
}

/**
 * Extract plain text from a Buffer based on detected MIME type.
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} originalName
 * @returns {Promise<string>}
 */
async function extractText(buffer, mimetype, originalName) {
  if (mimetype === 'application/pdf' || originalName.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    return data.text;
  }
  // All other supported types are plain text / code
  return buffer.toString('utf-8');
}

/**
 * Process an uploaded file Buffer into vectorized chunks ready for storage.
 *
 * @param {Buffer} buffer       Raw file bytes
 * @param {string} mimetype     MIME type from multer
 * @param {string} originalName Original file name (used for extension fallback)
 * @returns {Promise<Array<{ text: string, tokens: string[], tfidf: natural.TfIdf }>>}
 */
async function processFile(buffer, mimetype, originalName) {
  // 1. Extract text
  const rawText = await extractText(buffer, mimetype, originalName);

  // 2. Tokenize
  const tokens = tokenize(rawText);

  if (tokens.length === 0) {
    throw new Error(`File "${originalName}" produced no extractable text.`);
  }

  // 3. Chunk into overlapping windows
  const chunkStrings = chunkTokens(tokens);

  // 4. Build per-chunk metadata (tokens list for cosine similarity later)
  const chunks = chunkStrings.map((text) => ({
    text,
    tokens: tokenize(text),
  }));

  console.log(
    `[FileProcessor] "${originalName}": ${tokens.length} tokens → ${chunks.length} chunks`
  );

  return chunks;
}

module.exports = { processFile };
