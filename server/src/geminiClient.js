'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Custom error for authentication failures.
 */
class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Detect if any of the context chunks appear to be SQL schema / data.
 */
function detectSqlContext(contextChunks) {
  if (!contextChunks || contextChunks.length === 0) return false;
  const combined = contextChunks.join(' ').toUpperCase();
  const sqlKeywords = ['CREATE TABLE', 'INSERT INTO', 'SELECT', 'FROM', 'WHERE',
    'JOIN', 'PRIMARY KEY', 'FOREIGN KEY', 'ALTER TABLE', 'DROP TABLE', 'INDEX',
    'VARCHAR', 'INTEGER', 'BIGINT', 'TIMESTAMP', 'CONSTRAINT'];
  const hits = sqlKeywords.filter(kw => combined.includes(kw));
  return hits.length >= 2;
}

/**
 * Build the full prompt for Gemini, injecting retrieved context chunks.
 */
function buildPrompt(question, contextChunks, systemPrompt) {
  const isSqlContext = detectSqlContext(contextChunks);

  const defaultSys = isSqlContext
    ? `You are an expert SQL data analyst and database engineer.
You have been given database schema definitions, table structures, or SQL data as context.

Your responsibilities:
1. Write correct, optimized SQL queries that directly answer the user's question.
2. Use proper SQL syntax (compatible with standard SQL / PostgreSQL / MySQL as applicable).
3. Include comments in the SQL to explain complex logic.
4. If multiple approaches exist, explain the trade-offs.
5. Point out relevant columns, table relationships (JOINs), and index hints where useful.
6. If the schema is ambiguous, state your assumptions clearly.
7. Wrap ALL SQL code in triple-backtick sql code blocks.
8. After the SQL, provide a brief plain-English explanation of what the query does.`
    : `You are an expert AI knowledge assistant with access to uploaded documents.

Your responsibilities:
1. Answer questions accurately and thoroughly using the provided context.
2. Extract specific facts, names, dates, figures, and details precisely.
3. If the document is a resume or CV, extract: name, contact info, skills, experience, education, and projects accurately.
4. If the document contains technical content, provide detailed technical explanations.
5. If asked for links, URLs, or project references, quote them exactly as they appear in the document.
6. Structure your response clearly — use bullet points, numbered lists, or headers where it improves readability.
7. Cite the specific chunk(s) you used as [Chunk N] references.
8. If the context doesn't contain enough information to answer confidently, say so explicitly rather than guessing.`;

  const sys = systemPrompt || defaultSys;

  if (contextChunks.length === 0) {
    return `${sys}\n\nAnswer the following question:\n\n${question}`;
  }

  const contextBlock = contextChunks
    .map((chunk, i) => `[Document Chunk ${i + 1}]\n${chunk}`)
    .join('\n\n---\n\n');

  return `${sys}

=== DOCUMENT CONTEXT ===
${contextBlock}

=== USER QUESTION ===
${question}

=== RESPONSE INSTRUCTIONS ===
${isSqlContext
      ? `- Write complete, runnable SQL. Do not use placeholder table/column names — use the exact names from the schema above.
- If multiple tables are needed, use appropriate JOINs.
- Always include a plain-English explanation after the SQL code block.
- If the question is ambiguous, write the most likely interpretation and briefly mention alternatives.`
      : `- Answer precisely and completely.
- Pull exact data (names, numbers, dates, URLs) directly from the context — do not paraphrase facts.
- Use [Chunk N] citations to reference your sources.
- Use markdown formatting (bold, lists, tables) to improve readability.
- If the context is insufficient, clearly state what information is missing.`
    }
`;
}

/**
 * Generate a response using the user's Gemini API key.
 * Dynamically instantiates the GoogleGenerativeAI client per call (BYOK).
 *
 * @param {object} params
 * @param {string} params.apiKey        User's Gemini API key
 * @param {string} params.question      User's question
 * @param {string[]} params.contextChunks Retrieved document chunks
 * @param {string} [params.modelName]   Model name override
 * @param {string} [params.systemPrompt] System prompt override
 * @returns {Promise<string>}           The generated text response
 * @throws {AuthError}                  If the API key is invalid/expired
 */
async function generateResponse({ apiKey, question, contextChunks = [], modelName, systemPrompt }) {
  let genAI;
  try {
    genAI = new GoogleGenerativeAI(apiKey);
  } catch {
    throw new AuthError('Invalid Gemini API key format.');
  }

  const activeModel = modelName || 'gemini-2.5-flash';
  const model = genAI.getGenerativeModel({ model: activeModel });
  const prompt = buildPrompt(question, contextChunks, systemPrompt);

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.text();
  } catch (err) {
    // Detect auth failures from Google API
    const msg = (err.message || '').toLowerCase();
    if (
      msg.includes('api_key_invalid') ||
      msg.includes('api key not valid') ||
      msg.includes('unauthenticated') ||
      msg.includes('permission_denied') ||
      err.status === 401 ||
      err.status === 403
    ) {
      throw new AuthError(
        'Authentication Failure: Please refresh your Gemini API key inside the room settings console.'
      );
    }
    throw err;
  }
}

module.exports = { generateResponse, AuthError };
