/**
 * OpenAI Client - Embedding Generation
 *
 * Provides embedding generation for semantic search.
 * Uses text-embedding-3-small (1536 dimensions).
 */

import OpenAI from 'openai';

// Singleton OpenAI client
let openaiClient = null;

/**
 * Get or create OpenAI client instance
 * @returns {OpenAI}
 */
function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set in environment');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Generate embedding for text using OpenAI API
 * @param {string} text - Text to generate embedding for
 * @param {Object} options - Options
 * @param {number} options.maxLength - Maximum text length (default: 8000)
 * @param {number} options.retries - Number of retries on failure (default: 2)
 * @returns {Promise<number[]>} Embedding vector (1536 dimensions)
 * @throws {Error} If API call fails after retries
 */
export async function generateEmbedding(text, options = {}) {
  const {
    maxLength = 8000,
    retries = 2
  } = options;

  // Validate input
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }

  // Truncate text if too long
  const truncatedText = text.substring(0, maxLength);

  // Retry logic
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const client = getOpenAIClient();
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: truncatedText,
        encoding_format: 'float'
      });

      // Extract embedding
      const embedding = response.data[0].embedding;

      // Validate dimensions
      if (embedding.length !== 1536) {
        throw new Error(`Unexpected embedding dimensions: ${embedding.length} (expected 1536)`);
      }

      return embedding;

    } catch (error) {
      lastError = error;

      // Don't retry on validation errors
      if (error.message.includes('Unexpected embedding dimensions')) {
        throw error;
      }

      // Don't retry on permanent errors (quota exceeded, rate limit)
      // These errors indicate system-level issues that won't be resolved by retry
      const isPermanentError =
        error.message.includes('insufficient_quota') ||
        error.message.includes('quota_exceeded') ||
        error.code === 'insufficient_quota' ||
        (error.status === 429 && error.type === 'insufficient_quota');

      if (isPermanentError) {
        // Wrap error with clear message for upstream handling
        throw new Error(`OpenAI quota exceeded: ${error.message}`);
      }

      // Log retry attempt for temporary errors (network, rate limit, etc.)
      if (attempt < retries) {
        console.warn(`OpenAI API call failed (attempt ${attempt + 1}/${retries + 1}):`, error.message);
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  // All retries failed
  throw new Error(`OpenAI API call failed after ${retries + 1} attempts: ${lastError.message}`);
}

/**
 * Generate embeddings for multiple texts in batch
 * @param {string[]} texts - Array of texts
 * @param {Object} options - Options (same as generateEmbedding)
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
export async function generateEmbeddingsBatch(texts, options = {}) {
  // Process in parallel (OpenAI API supports batch but we process individually for simplicity)
  const embeddings = await Promise.all(
    texts.map(text => generateEmbedding(text, options))
  );
  return embeddings;
}

/**
 * Test OpenAI API connection
 * @returns {Promise<boolean>} True if API is accessible
 */
export async function testOpenAIConnection() {
  try {
    await generateEmbedding('test');
    return true;
  } catch (error) {
    console.error('OpenAI API connection test failed:', error.message);
    return false;
  }
}

export default {
  generateEmbedding,
  generateEmbeddingsBatch,
  testOpenAIConnection
};
