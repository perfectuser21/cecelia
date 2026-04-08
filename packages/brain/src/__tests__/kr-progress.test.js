/**
 * KR Progress Calculator 测试
 * DoD: D6, D7, D8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateKrProgress, syncAllKrProgress } from '../kr-progress.js';

// ────────────────────────────────────────────────────────────────────
// 工具函数：构造 mock pool
// ────────────────────────────────────────────────────────────────────

function makeMockPool({
  projects = [],
  initiativeStats = { total: '0', completed: '0' },
  krs = [],
} = {}) {
  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();

      // updateKrProgress: 查 KR 关联的 projects (FROM okr_projects WHERE op.kr_id = $1)
      if (s.includes('FROM okr_projects') && s.includes('op.kr_id') && !s.includes('UPDATE')) {
        return { rows: projects };
      }

      // updateKrProgress: 查 initiatives 统计 (FROM okr_initiatives ... ANY($1))
      if (s.includes('COUNT(*)') && s.includes('FROM okr_initiatives') && s.includes('ANY(')) {
        return { rows: [initiativeStats] };
      }

      // updateKrProgress: UPDATE key_results SET progress = $2, updated_at = NOW()
      if (s.includes('UPDATE key_results') && s.includes('progress')) {
        return { rows: [] };
      }

      // syncAllKrProgress: 查 key_results 排除已有 verifier 的 KR
      if (s.includes('FROM key_results') && s.includes('kr_verifiers')) {
        return { rows: krs };
      }

      return { rows: [] };
    }),
  };
}

// ────────────────────────────────────────────────────────────────────
// D6: updateKrProgress
// ────────────────────────────────────────────────────────────────────

describe('D6: updateKrProgress', () => {
  it('calculates progress from initiative completion ratio', async () => {
    const pool = makeMockPool({
      projects: [{ id: 'proj-001' }],
      initiativeStats: { total: '10', completed: '3' },
    });

    const result = await updateKrProgress(pool, 'kr-001');

    expect(result.krId).toBe('kr-001');
    expect(result.progress).toBe(30);  // 3/10 * 100
    expect(result.completed).toBe(3);
    expect(result.total).toBe(10);

    // 验证 UPDATE key_results SET progress 被调用
    const updateCall = pool.query.mock.calls.find(c =>
      c[0].includes('UPDATE key_results') && c[0].includes('progress')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toEqual(['kr-001', 30]);
  });

  it('handles zero initiatives gracefully (progress = 0)', async () => {
    const pool = makeMockPool({
      projects: [{ id: 'proj-001' }],
      initiativeStats: { total: '0', completed: '0' },
    });

    const result = await updateKrProgress(pool, 'kr-001');

    expect(result.progress).toBe(0);
    expect(result.total).toBe(0);
  });

  it('handles null krId gracefully', async () => {
    const pool = makeMockPool();

    const result = await updateKrProgress(pool, null);

    expect(result.progress).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('handles no linked projects', async () => {
    const pool = makeMockPool({
      projects: [],
    });

    const result = await updateKrProgress(pool, 'kr-no-projects');

    expect(result.progress).toBe(0);
    expect(result.total).toBe(0);
  });

  it('rounds progress correctly', async () => {
    const pool = makeMockPool({
      projects: [{ id: 'proj-001' }],
      initiativeStats: { total: '3', completed: '1' },
    });

    const result = await updateKrProgress(pool, 'kr-001');

    expect(result.progress).toBe(33);  // Math.round(1/3 * 100) = 33
  });

  it('calculates 100% when all completed', async () => {
    const pool = makeMockPool({
      projects: [{ id: 'proj-001' }],
      initiativeStats: { total: '5', completed: '5' },
    });

    const result = await updateKrProgress(pool, 'kr-001');

    expect(result.progress).toBe(100);
  });
});

// ────────────────────────────────────────────────────────────────────
// D6: syncAllKrProgress
// ────────────────────────────────────────────────────────────────────

describe('D6: syncAllKrProgress', () => {
  it('syncs active KRs without verifiers', async () => {
    const pool = makeMockPool({
      projects: [{ id: 'proj-001' }],
      initiativeStats: { total: '4', completed: '2' },
      krs: [
        { id: 'kr-001', title: 'KR1' },
        { id: 'kr-002', title: 'KR2' },
      ],
    });

    const result = await syncAllKrProgress(pool);

    // 每个 KR 都有 projects，所以都会被 updated
    expect(result.updated).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  it('skips KRs with no initiatives', async () => {
    const pool = makeMockPool({
      projects: [{ id: 'proj-001' }],
      initiativeStats: { total: '0', completed: '0' },
      krs: [{ id: 'kr-001', title: 'KR1' }],
    });

    const result = await syncAllKrProgress(pool);

    expect(result.updated).toBe(0);
  });
});
