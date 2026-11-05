// 本文件模拟凭据/传输；真实隔离判断由runtime直接I/O回归验证。
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
/**
 * Tests for OpenAI Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateEmbedding, generateEmbeddingsBatch, testOpenAIConnection } from '../openai-client.js';

const sdk = vi.hoisted(() => ({ create: vi.fn() }));

// Record the real client request at its SDK boundary; never construct a live SDK.
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      constructor() {
        this.embeddings = {
          create: sdk.create
        };
      }
    }
  };
});

describe('OpenAI Client', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'owned-synthetic-key');
    sdk.create.mockReset().mockResolvedValue({ data: [{ embedding: new Array(1536).fill(0.1) }] });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'));
  });

  afterEach(() => {
    try {
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for valid text', async () => {
      const text = '用户登录功能';
      const embedding = await generateEmbedding(text);

      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(1536);
    });

    it('should throw error for invalid input', async () => {
      await expect(generateEmbedding('')).rejects.toThrow('Text must be a non-empty string');
      await expect(generateEmbedding(null)).rejects.toThrow('Text must be a non-empty string');
    });

    it('should truncate long text', async () => {
      const longText = 'a'.repeat(10000);
      const embedding = await generateEmbedding(longText);

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(1536);
      expect(sdk.create).toHaveBeenCalledTimes(1);
      expect(sdk.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small', input: 'a'.repeat(8000), encoding_format: 'float',
      });
    });

    it('sends the exact custom-length prefix and leaves short inputs unchanged', async () => {
      await generateEmbedding('keep-discarded-tail', { maxLength: 4 });
      await generateEmbedding('ok', { maxLength: 4 });
      expect(sdk.create.mock.calls.map(([request]) => request)).toEqual([
        { model: 'text-embedding-3-small', input: 'keep', encoding_format: 'float' },
        { model: 'text-embedding-3-small', input: 'ok', encoding_format: 'float' },
      ]);
    });
  });

  describe('generateEmbeddingsBatch', () => {
    it('should generate embeddings for multiple texts', async () => {
      const texts = ['用户登录', 'Task创建', 'PR合并'];
      const embeddings = await generateEmbeddingsBatch(texts);

      expect(embeddings.length).toBe(3);
      embeddings.forEach(emb => {
        expect(emb.length).toBe(1536);
      });
    });
  });

  describe('generateEmbeddingsBatch input limits', () => {
    it('forwards custom options to each actual generateEmbedding call', async () => {
      const embeddings = await generateEmbeddingsBatch(['first-tail', 'other-tail'], { maxLength: 5 });
      expect(embeddings).toHaveLength(2);
      expect(embeddings.every(vector => vector.length === 1536)).toBe(true);
      expect(sdk.create.mock.calls.map(([request]) => request)).toEqual([
        { model: 'text-embedding-3-small', input: 'first', encoding_format: 'float' },
        { model: 'text-embedding-3-small', input: 'other', encoding_format: 'float' },
      ]);
    });
  });

  describe('testOpenAIConnection', () => {
    it('should return true for successful connection', async () => {
      const result = await testOpenAIConnection();
      expect(result).toBe(true);
    });
  });

  // Note: Quota exceeded error handling and retry logic tests
  // are covered by integration tests in generate-capability-embeddings.test.js
  // due to complexity of mocking OpenAI client behavior
});
