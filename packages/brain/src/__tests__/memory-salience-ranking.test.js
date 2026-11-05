import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundaries = vi.hoisted(() => ({
  semantic: vi.fn(() => { throw new Error('unexpected semantic search'); }),
  learning: vi.fn(() => { throw new Error('unexpected learning search'); }),
  embedding: vi.fn(() => { throw new Error('unexpected embedding'); }),
  document: vi.fn(async () => null),
}));
vi.mock('../similarity.js', () => ({ default: boundaries.semantic }));
vi.mock('../learning.js', () => ({ searchRelevantLearnings: boundaries.learning }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: boundaries.embedding }));
vi.mock('../distilled-docs.js', () => ({ getDoc: boundaries.document }));

import { buildMemoryContext } from '../memory-retriever.js';
import { routeMemory } from '../memory-router.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
let fetchGuard;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('OPENAI_API_KEY', '');
  fetchGuard = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'));
});

afterEach(() => {
  try {
    expect(boundaries.semantic).not.toHaveBeenCalled();
    expect(boundaries.learning).not.toHaveBeenCalled();
    expect(boundaries.embedding).not.toHaveBeenCalled();
    expect(fetchGuard).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});

async function recall(scores) {
  // Equal age, importance, token count and query overlap; only salience differs.
  const rows = ['alphamark', 'bravomark'].map((marker, index) => ({
    id: marker,
    content: `needle common ${marker}`,
    summary: `needle common ${marker}`,
    importance: 5,
    memory_type: 'long',
    created_at: NOW.toISOString(),
    salience_score: scores[index],
  }));
  const pool = {
    query: vi.fn(async (sql) => {
      if (!/^\s*SELECT\b/i.test(sql)) throw new Error('unexpected write query');
      if (sql.includes('FROM memory_stream') && sql.includes('source_type IS NULL')) {
        return { rows };
      }
      if (sql.includes('FROM memory_stream') && sql.includes("source_type = 'conversation_turn'")) {
        return { rows: [] };
      }
      if (/FROM (user_profile_facts|objectives|cecelia_events)\b/.test(sql)) return { rows: [] };
      throw new Error(`unexpected record-only query: ${sql}`);
    }),
  };
  expect(routeMemory('reflection needle', 'chat').intentType).toBe('self_reflection');
  const result = await buildMemoryContext({ query: 'reflection needle', mode: 'chat', tokenBudget: 1000, pool });
  expect(result.meta.candidates).toBe(2);
  expect(result.meta.injected).toBe(2);
  expect(result.meta.sources).toEqual(['episodic', 'episodic']);
  expect(result.block).toContain('alphamark');
  expect(result.block).toContain('bravomark');
  expect(pool.query.mock.calls.some(([sql]) => sql.includes('source_type IS NULL'))).toBe(true);
  return result.block;
}

describe('buildMemoryContext episodic salience ranking', () => {
  it('moves the higher-salience second candidate ahead of equally relevant first input', async () => {
    const block = await recall([0.1, 0.9]);
    expect(block.indexOf('bravomark')).toBeLessThan(block.indexOf('alphamark'));
  });

  it('reverses the output when only the two salience values are exchanged', async () => {
    const block = await recall([0.9, 0.1]);
    expect(block.indexOf('alphamark')).toBeLessThan(block.indexOf('bravomark'));
  });

  it('keeps both legacy null and zero-salience candidates without scoring errors', async () => {
    await recall([null, 0]);
  });
});
