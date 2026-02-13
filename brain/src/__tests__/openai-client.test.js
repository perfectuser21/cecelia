/**
 * Tests for OpenAI Client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateEmbedding, generateEmbeddingsBatch, testOpenAIConnection } from '../openai-client.js';

// Mock OpenAI SDK
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{
            embedding: new Array(3072).fill(0.1)  // Mock 3072-dim vector
          }]
        })
      }
    }))
  };
});

describe('OpenAI Client', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for valid text', async () => {
      const text = '用户登录功能';
      const embedding = await generateEmbedding(text);

      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(3072);
    });

    it('should throw error for invalid input', async () => {
      await expect(generateEmbedding('')).rejects.toThrow('Text must be a non-empty string');
      await expect(generateEmbedding(null)).rejects.toThrow('Text must be a non-empty string');
    });

    it('should truncate long text', async () => {
      const longText = 'a'.repeat(10000);
      const embedding = await generateEmbedding(longText, { maxLength: 8000 });

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(3072);
    });
  });

  describe('generateEmbeddingsBatch', () => {
    it('should generate embeddings for multiple texts', async () => {
      const texts = ['用户登录', 'Task创建', 'PR合并'];
      const embeddings = await generateEmbeddingsBatch(texts);

      expect(embeddings.length).toBe(3);
      embeddings.forEach(emb => {
        expect(emb.length).toBe(3072);
      });
    });
  });

  describe('testOpenAIConnection', () => {
    it('should return true for successful connection', async () => {
      const result = await testOpenAIConnection();
      expect(result).toBe(true);
    });
  });
});
