/**
 * Workstream 2 — runHarnessInitiativeRouter 单元层守护 [BEHAVIOR]
 *
 * Round 1 — fallback 测试（PRD 引用的 executor-harness-initiative-status-writeback.test.js
 * 经 grep 确认在当前 main 上不存在）。本文件覆盖 PRD 列举的 4 个边界情况，断言
 * `runHarnessInitiativeRouter` 的返回值 / 副作用与 PRD 描述一致。
 *
 * 测试故意先红（mock 还没搭好；router 的 watchdog 分支也可能尚未稳定输出 failure_class）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 真实 import 生产代码 — 不允许写空 stub 假绿
// 路径相对于本文件：sprints/golden-path-verify-20260507/tests/ws2/ → 仓库根 packages/brain/src/executor.js
const PROD_PATH = '../../../../packages/brain/src/executor.js';

interface FakePool {
  query: ReturnType<typeof vi.fn>;
}

function makePool(): FakePool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ deadline_at: null }] }),
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    task_type: 'harness_initiative',
    payload: { initiative_id: '00000000-0000-0000-0000-000000000001' },
    execution_attempts: 0,
    ...overrides,
  };
}

async function importRouter() {
  // 动态 import — 让 vi.mock 有机会先注入
  const mod = await import(PROD_PATH);
  return mod.runHarnessInitiativeRouter;
}

describe('WS2 — runHarnessInitiativeRouter status writeback [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('graph 返回 final={} (无 error) → router 返回 ok=true', async () => {
    const router = await importRouter();
    const compiled = {
      stream: vi.fn().mockImplementation(async function* () {
        yield { someNode: { ok: true } };
      }),
    };
    const pool = makePool();
    const result = await router(makeTask(), { pool, compiled });
    expect(result.ok).toBe(true);
    expect(result.finalState?.error).toBeUndefined();
  });

  it('graph 返回 final.error="evaluator_fail" → router 返回 ok=false', async () => {
    const router = await importRouter();
    const compiled = {
      stream: vi.fn().mockImplementation(async function* () {
        yield { evaluator: { error: 'evaluator_fail' } };
      }),
    };
    const pool = makePool();
    const result = await router(makeTask(), { pool, compiled });
    expect(result.ok).toBe(false);
    expect(result.finalState?.error).toBe('evaluator_fail');
  });

  it('compiled.stream 抛 AbortError(watchdog) → 写 failure_class=watchdog_deadline 并返回 ok=false', async () => {
    const router = await importRouter();
    const abortErr = Object.assign(new Error('harness_watchdog: deadline exceeded'), { name: 'AbortError' });
    const compiled = {
      stream: vi.fn().mockImplementation(async function* () {
        throw abortErr;
        // unreachable — keep TS happy
        // eslint-disable-next-line no-unreachable
        yield {};
      }),
    };
    const pool = makePool();
    const result = await router(makeTask(), { pool, compiled });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('watchdog_deadline');
    // 验证 failure_class 写库
    const writeCall = pool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('failure_class') && sql.includes('watchdog_deadline'),
    );
    expect(writeCall, 'expected pool.query to write failure_class=watchdog_deadline').toBeDefined();
  });

  it('compiled.stream 抛任意未知异常 → router 异常上抛（不静默吞）', async () => {
    const router = await importRouter();
    const compiled = {
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error('unexpected db connection lost');
        // eslint-disable-next-line no-unreachable
        yield {};
      }),
    };
    const pool = makePool();
    await expect(router(makeTask(), { pool, compiled })).rejects.toThrow(/unexpected db connection lost/);
  });
});
