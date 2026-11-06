import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundaries = vi.hoisted(() => ({
  db: vi.fn(() => { throw new Error('unexpected canonical DB'); }),
  embedding: vi.fn(() => { throw new Error('unexpected embedding'); }),
  fetch: vi.fn(() => { throw new Error('unexpected network'); }),
  semantic: vi.fn().mockResolvedValue({ matches: [] }),
}));
vi.mock('../db.js', () => ({ default: { query: boundaries.db } }));
vi.mock('../similarity.js', () => ({ default: class {
  searchWithVectors(...args) { return boundaries.semantic(...args); }
} }));
vi.mock('../learning.js', () => ({ searchRelevantLearnings: vi.fn().mockResolvedValue([]) }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: boundaries.embedding }));
vi.mock('../memory-utils.js', () => ({ generateL0Summary: vi.fn() }));
vi.mock('../distilled-docs.js', () => ({ getDoc: vi.fn().mockResolvedValue(null) }));
vi.mock('../memory-router.js', () => ({ routeMemory: vi.fn(() => {
  throw new Error('execute mode does not route chat memory');
}) }));

import { buildMemoryContext } from '../memory-retriever.js';

function row(id, type) {
  return { id, type, title: `needle ${id}`, description: 'owned evidence',
    created_at: '2026-11-06T00:00:00Z', status: 'active' };
}

async function retrieve(rows) {
  const query = vi.fn(async sql => {
    expect(sql).toMatch(/^\s*SELECT/);
    return { rows: sql.includes("'area_okr' AS type") ? rows : [] };
  });
  const result = await buildMemoryContext({ query: 'needle', mode: 'execute',
    tokenBudget: 2500, pool: { query } });
  const union = query.mock.calls.filter(([sql]) => sql.includes('UNION ALL'));
  expect(union).toHaveLength(1);
  expect(union[0][0]).toContain('FROM objectives');
  expect(union[0][0]).toContain('FROM key_results');
  expect(boundaries.semantic).toHaveBeenCalledWith('needle', {
    topK: 20, fallbackToJaccard: true,
  });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', boundaries.fetch);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  try {
    expect(boundaries.db).not.toHaveBeenCalled();
    expect(boundaries.embedding).not.toHaveBeenCalled();
    expect(boundaries.fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

describe('real memory entry preserves Objective and KR contracts', () => {
  it('labels an Objective as OKR and preserves a key result as KR', async () => {
    const result = await retrieve([row('objective', 'area_okr'), row('keyresult', 'area_kr')]);
    expect(result.meta.injected).toBe(2);
    expect(result.meta.sources).toEqual(['kr', 'okr']);
    expect(result.block).toContain('[OKR] **needle objective**');
    expect(result.block).toContain('[KR目标] **needle keyresult**');
  });

  it('applies the existing execute weights before producing the context order', async () => {
    const result = await retrieve([row('objective', 'area_okr'), row('keyresult', 'area_kr')]);
    expect(result.block.indexOf('needle keyresult')).toBeLessThan(result.block.indexOf('needle objective'));
  });

  it('does not consume KR maximum quota with Objective rows', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => row(`objective${i}`, 'area_okr'));
    rows.push(...Array.from({ length: 4 }, (_, i) => row(`keyresult${i}`, 'area_kr')));
    const result = await retrieve(rows);
    expect(result.meta.injected).toBe(7);
    expect(result.meta.sources.filter(s => s === 'okr')).toHaveLength(4);
    expect(result.meta.sources.filter(s => s === 'kr')).toHaveLength(3);
  });
});
