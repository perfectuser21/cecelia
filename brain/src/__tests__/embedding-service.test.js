/**
 * Tests for embedding-service.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock openai-client
vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn()
}));

// Mock db pool
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

import { generateTaskEmbeddingAsync } from '../embedding-service.js';
import { generateEmbedding } from '../openai-client.js';
import pool from '../db.js';

describe('generateTaskEmbeddingAsync', () => {
  const taskId = 'test-task-uuid-1234';
  const title = 'Test task title';
  const description = 'Test description';
  const fakeEmbedding = Array(1536).fill(0.1);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('no-op when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    await generateTaskEmbeddingAsync(taskId, title, description);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('generates and saves embedding when API key is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    generateEmbedding.mockResolvedValue(fakeEmbedding);
    pool.query.mockResolvedValue({ rows: [] });

    await generateTaskEmbeddingAsync(taskId, title, description);

    expect(generateEmbedding).toHaveBeenCalledOnce();
    expect(generateEmbedding).toHaveBeenCalledWith(`${title}\n\n${description}`);
    expect(pool.query).toHaveBeenCalledOnce();
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('UPDATE tasks SET embedding');
    expect(params[1]).toBe(taskId);
  });

  it('handles missing description gracefully', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    generateEmbedding.mockResolvedValue(fakeEmbedding);
    pool.query.mockResolvedValue({ rows: [] });

    await generateTaskEmbeddingAsync(taskId, title, null);

    expect(generateEmbedding).toHaveBeenCalledWith(`${title}\n\n`);
  });

  it('fails silently on OpenAI error', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    generateEmbedding.mockRejectedValue(new Error('OpenAI quota exceeded'));
    // Should not throw
    await expect(generateTaskEmbeddingAsync(taskId, title, description)).resolves.toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('fails silently on DB error', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    generateEmbedding.mockResolvedValue(fakeEmbedding);
    pool.query.mockRejectedValue(new Error('DB connection failed'));
    // Should not throw
    await expect(generateTaskEmbeddingAsync(taskId, title, description)).resolves.toBeUndefined();
  });
});
