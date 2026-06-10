/**
 * PR 2b-1 回归测试：okr_initiatives 生命周期状态机
 *
 * 锁定语义保持的重命名：
 *   pending  → planned
 *   active   → running   (in_progress 同义并入)
 *   completed→ done
 *   queued / archived 不变
 *
 * 断言关键调度函数发出的 SQL 使用新生命周期词汇，且不再出现旧的
 * in-flight 字面值（active / in_progress / pending / completed）。
 * 这是 2b-2 harness 认领 planned 的前置不变量。
 */

import { describe, it, expect, vi } from 'vitest';
import { activateNextInitiatives, checkInitiativeCompletion } from '../initiative-closer.js';
import { checkOkrInitiativeCompletion } from '../okr-closer.js';

/** 捕获所有发往 okr_initiatives 的 SQL（trim 后）。 */
function captureInitiativeSql(calls) {
  return calls
    .map(c => c[0].trim())
    .filter(s => s.includes('okr_initiatives'));
}

describe('2b-1: activateNextInitiatives 走 planned → running', () => {
  it('激活语句 SET status = running，选取 status = planned，不含旧值 active/pending', async () => {
    const pool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const s = sql.trim();
        if (s.includes('FROM okr_initiatives') && s.includes('COUNT(*) AS cnt')) {
          return { rows: [{ cnt: '0' }] };
        }
        if (s.includes('UPDATE okr_initiatives') && s.includes("status = 'running'") && s.includes('RETURNING id')) {
          return { rows: [{ id: 'i1', name: 'A' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const activated = await activateNextInitiatives(pool);
    expect(activated).toBe(1);

    const sqls = captureInitiativeSql(pool.query.mock.calls);
    const update = sqls.find(s => s.includes('UPDATE okr_initiatives'));
    expect(update).toBeDefined();
    expect(update).toContain("status = 'running'");
    expect(update).toContain("status = 'planned'"); // 选取 planned 行激活
    expect(update).not.toContain("status = 'active'");
    expect(update).not.toContain("status = 'pending'");
  });
});

describe('2b-1: checkInitiativeCompletion 走 running → done', () => {
  it('查 running 的 initiative，完成后 SET status = done，不含旧值', async () => {
    const pool = {
      query: vi.fn().mockImplementation(async (sql) => {
        const s = sql.trim();
        // 查待关闭的 in-flight initiatives（新值 running）
        if (s.includes('FROM okr_initiatives') && s.includes("status IN ('running')")) {
          return { rows: [{ id: 'i1', name: 'A' }] };
        }
        if (s.includes('COUNT(*)') && s.includes('FROM tasks')) {
          return { rows: [{ total: '2', queued: '0', in_progress: '0' }] };
        }
        if (s.includes('UPDATE okr_initiatives') && s.includes("status = 'done'")) {
          return { rows: [] };
        }
        if (s.includes('FROM okr_initiatives') && s.includes('COUNT(*) AS cnt')) {
          return { rows: [{ cnt: '5' }] };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const result = await checkInitiativeCompletion(pool);
    expect(result.closedCount).toBe(1);

    const sqls = captureInitiativeSql(pool.query.mock.calls);
    const allInit = sqls.join('\n');
    const closeUpdate = sqls.find(s => s.includes('UPDATE okr_initiatives') && s.includes('completed_at'));
    expect(closeUpdate).toBeDefined();
    expect(closeUpdate).toContain("status = 'done'");
    // 不应再出现旧的 in-flight 关闭值
    expect(allInit).not.toContain("status = 'completed'");
    expect(allInit).not.toContain("status IN ('in_progress', 'active')");
  });
});

describe('2b-1: checkOkrInitiativeCompletion 走 done 词汇', () => {
  it('查未完成 NOT IN (done,...)，完成后 SET status = done', async () => {
    const pool = {
      query: vi.fn().mockImplementation(async (sql) => {
        const s = sql.trim();
        if (s.includes('FROM okr_initiatives') && s.includes("status NOT IN ('done'") && !s.includes('scope_id = $1')) {
          return { rows: [{ id: 'i1', title: 'A', scope_id: null }] };
        }
        if (s.includes('COUNT(*)') && s.includes('FROM tasks')) {
          return { rows: [{ total: '1', queued: '0', in_progress: '0', quarantine: '0' }] };
        }
        if (s.includes('UPDATE okr_initiatives') && s.includes("status = 'done'")) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(1);

    const sqls = captureInitiativeSql(pool.query.mock.calls);
    const update = sqls.find(s => s.includes('UPDATE okr_initiatives'));
    expect(update).toBeDefined();
    expect(update).toContain("status = 'done'");
    expect(sqls.join('\n')).not.toContain("status = 'completed'");
  });
});
