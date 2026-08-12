/**
 * existing-pr-authority — 权威 pr_url 贯通与终态收账回归测试
 *
 * 覆盖真实生产漏洞（task 2afe5062）：
 *   - Agent stdout 只写 "PR #4827"（无完整 URL）
 *   - tasks.payload.existing_pr_url / tasks.pr_url 有权威 URL
 *   - callback_queue 仍写入 null → maybeMarkCompletedNoPr 标 completed_no_pr → 3 次重跑
 *
 * 五个修复断言：
 *   1. writeDockerCallback: stdout 无 URL 但 task 有 existing_pr_url → _meta.pr_url 非 null
 *   2. maybeMarkCompletedNoPr: task.pr_url 列有值 → 不返回 completed_no_pr
 *   3. maybeMarkCompletedNoPr: payload.existing_pr_url 有值 → 不返回 completed_no_pr
 *   4. matchTaskByBranchOrUrl: 按 prUrl 精确匹配（含 completed_no_pr 状态）
 *   5. handlePrMerged: 按 exact prUrl 兜底匹配 + 写 pr_status=merged + 清 current_run_id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// 场景 1: writeDockerCallback — stdout 无完整 URL，task 有 existing_pr_url
// ─────────────────────────────────────────────────────────────────────────────
describe('writeDockerCallback — 权威 pr_url 从 task 字段兜底', () => {
  it('stdout 仅含 PR #号（无完整 URL），task.payload.existing_pr_url 有值 → _meta.pr_url 写入权威 URL', async () => {
    const insertedRows = [];
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (/INSERT INTO callback_queue/i.test(sql)) {
          insertedRows.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const task = {
      id: '2afe5062-39eb-4b92-afb7-321d49817709',
      task_type: 'dev',
      pr_url: null,
      payload: {
        existing_pr_url: 'https://github.com/perfectuser21/cecelia/pull/4827',
        expected_branch: 'cp-0812040300-unique-run-terminal-fix',
      },
    };

    const dockerResult = {
      exit_code: 0,
      timed_out: false,
      // stdout 只写 PR 号，没有完整 URL
      stdout: '最终完成。pr_url: null\n本次修复已提交 PR #4827，请合并。',
      stderr: '',
      container: 'container-abc',
      started_at: '2026-08-12T03:00:00Z',
      ended_at: '2026-08-12T03:30:00Z',
      duration_ms: 1800000,
    };

    const { writeDockerCallback } = await import('../docker-executor.js');
    await writeDockerCallback(task, 'run-001', null, dockerResult, mockPool);

    expect(insertedRows.length).toBeGreaterThan(0);
    const row = insertedRows[0];
    // result_json 是 params[4]（第5个参数）
    const resultJson = JSON.parse(row.params[4]);
    // 修复前：_meta.pr_url = null（stdout 解析结果）
    // 修复后：_meta.pr_url = 'https://github.com/perfectuser21/cecelia/pull/4827'（从 task 兜底）
    expect(resultJson._meta.pr_url).toBe('https://github.com/perfectuser21/cecelia/pull/4827');
  });

  it('stdout 有完整 URL 时优先使用 stdout 的 URL，不被 task 字段覆盖', async () => {
    const insertedRows = [];
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (/INSERT INTO callback_queue/i.test(sql)) {
          insertedRows.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const task = {
      id: 'task-priority-check',
      task_type: 'dev',
      pr_url: 'https://github.com/x/y/pull/100',
      payload: {
        existing_pr_url: 'https://github.com/x/y/pull/999',
      },
    };

    const dockerResult = {
      exit_code: 0,
      timed_out: false,
      stdout: 'pr_url: https://github.com/x/y/pull/42',
      stderr: '',
      container: 'container-xyz',
      started_at: '2026-08-12T03:00:00Z',
      ended_at: '2026-08-12T03:10:00Z',
      duration_ms: 600000,
    };

    const { writeDockerCallback } = await import('../docker-executor.js');
    await writeDockerCallback(task, 'run-002', null, dockerResult, mockPool);

    const row = insertedRows[0];
    const resultJson = JSON.parse(row.params[4]);
    // stdout 优先
    expect(resultJson._meta.pr_url).toBe('https://github.com/x/y/pull/42');
  });

  it('task.pr_url 列有值，优先级高于 payload.existing_pr_url', async () => {
    const insertedRows = [];
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (/INSERT INTO callback_queue/i.test(sql)) {
          insertedRows.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const task = {
      id: 'task-pr-col',
      task_type: 'dev',
      pr_url: 'https://github.com/x/y/pull/200',   // DB 列
      payload: {
        existing_pr_url: 'https://github.com/x/y/pull/999', // 低优先级
      },
    };

    const dockerResult = {
      exit_code: 0,
      timed_out: false,
      stdout: '完成任务',  // 无 URL
      stderr: '',
      container: 'container-col',
      started_at: '2026-08-12T03:00:00Z',
      ended_at: '2026-08-12T03:05:00Z',
      duration_ms: 300000,
    };

    const { writeDockerCallback } = await import('../docker-executor.js');
    await writeDockerCallback(task, 'run-003', null, dockerResult, mockPool);

    const row = insertedRows[0];
    const resultJson = JSON.parse(row.params[4]);
    // task.pr_url 优先于 payload.existing_pr_url
    expect(resultJson._meta.pr_url).toBe('https://github.com/x/y/pull/200');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 场景 2 & 3: maybeMarkCompletedNoPr — DB pr_url 字段兜底
// ─────────────────────────────────────────────────────────────────────────────
describe('maybeMarkCompletedNoPr — 已知 existing_pr_url 不标 completed_no_pr', () => {
  it('task.pr_url 列有值（callback pr_url=null）→ 返回 completed，不返回 completed_no_pr', async () => {
    const mockPool = {
      query: vi.fn(async () => ({
        rows: [{
          task_type: 'dev',
          pr_url: 'https://github.com/perfectuser21/cecelia/pull/4827',
          payload: { existing_pr_url: null },
        }],
      })),
    };

    const { maybeMarkCompletedNoPr } = await import('../lib/callback-utils.js');
    // 修复前：pr_url=null(callback) → 返回 'completed_no_pr'
    // 修复后：DB tasks.pr_url 有值 → 返回 'completed'
    const result = await maybeMarkCompletedNoPr('completed', null, 'task-with-pr-col', mockPool, 'test');
    expect(result).toBe('completed');
  });

  it('task.payload.existing_pr_url 有值（callback pr_url=null）→ 返回 completed', async () => {
    const mockPool = {
      query: vi.fn(async () => ({
        rows: [{
          task_type: 'dev',
          pr_url: null,
          payload: {
            existing_pr_url: 'https://github.com/perfectuser21/cecelia/pull/4827',
          },
        }],
      })),
    };

    const { maybeMarkCompletedNoPr } = await import('../lib/callback-utils.js');
    const result = await maybeMarkCompletedNoPr('completed', null, 'task-with-existing-pr', mockPool, 'test');
    expect(result).toBe('completed');
  });

  it('task.payload.pr_url 有值（callback pr_url=null）→ 返回 completed', async () => {
    const mockPool = {
      query: vi.fn(async () => ({
        rows: [{
          task_type: 'dev',
          pr_url: null,
          payload: {
            pr_url: 'https://github.com/x/y/pull/55',
          },
        }],
      })),
    };

    const { maybeMarkCompletedNoPr } = await import('../lib/callback-utils.js');
    const result = await maybeMarkCompletedNoPr('completed', null, 'task-payload-pr-url', mockPool, 'test');
    expect(result).toBe('completed');
  });

  it('task 完全没有 pr_url（callback=null, DB=null, payload=null）→ 返回 completed_no_pr', async () => {
    const mockPool = {
      query: vi.fn(async () => ({
        rows: [{
          task_type: 'dev',
          pr_url: null,
          payload: {},
        }],
      })),
    };

    const { maybeMarkCompletedNoPr } = await import('../lib/callback-utils.js');
    const result = await maybeMarkCompletedNoPr('completed', null, 'task-no-pr', mockPool, 'test');
    expect(result).toBe('completed_no_pr');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 场景 4: matchTaskByBranchOrUrl — 按 prUrl 精确匹配（含 completed_no_pr）
// ─────────────────────────────────────────────────────────────────────────────
describe('matchTaskByBranchOrUrl — 按 prUrl 精确匹配', () => {
  it('按 exact prUrl 匹配 in_progress 任务（branch 无匹配时）', async () => {
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4827';
    const branchName = 'cp-0812040300-unique-run-terminal-fix';

    const mockPool = {
      query: vi.fn(async (sql) => {
        // in_progress by branch (has metadata->>'branch' in SQL) → empty
        if (/status\s*=\s*'in_progress'/i.test(sql) && /metadata.*branch|pr_branch/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        // in_progress by prUrl (has pr_url = $ or existing_pr_url in SQL) → return task
        if (/status\s*=\s*'in_progress'/i.test(sql) && /pr_url\s*=\s*\$|existing_pr_url/i.test(sql)) {
          return {
            rows: [{
              id: '2afe5062-39eb-4b92-afb7-321d49817709',
              title: 'fix existing PR',
              status: 'in_progress',
              project_id: null,
              goal_id: null,
              metadata: {},
              payload: { existing_pr_url: prUrl },
              task_type: 'dev',
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const { matchTaskByBranchOrUrl } = await import('../pr-callback-handler.js');
    // 修复前：只按 branchName 查，返回 null
    // 修复后：额外按 prUrl 查，返回任务
    const task = await matchTaskByBranchOrUrl(mockPool, branchName, prUrl);
    expect(task).not.toBeNull();
    expect(task.id).toBe('2afe5062-39eb-4b92-afb7-321d49817709');
  });

  it('按 branchName 或 prUrl 匹配 completed_no_pr 状态的任务', async () => {
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4827';
    const branchName = 'cp-0812040300-unique-run-terminal-fix';

    const mockPool = {
      query: vi.fn(async (sql) => {
        // in_progress → 空
        if (/status\s*=\s*'in_progress'/i.test(sql)) return { rows: [], rowCount: 0 };
        // completed 单状态（不含 completed_no_pr）→ 空
        if (/IN\s*\(.*'completed'[^)]*\)/i.test(sql) && !/completed_no_pr/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        // 含 completed_no_pr 的查询 → 返回任务
        if (/completed_no_pr/i.test(sql)) {
          return {
            rows: [{
              id: 'task-no-pr-state',
              title: 'fix PR',
              status: 'completed_no_pr',
              project_id: null,
              goal_id: null,
              metadata: { branch: branchName },
              payload: { existing_pr_url: prUrl },
              task_type: 'dev',
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const { matchTaskByBranchOrUrl } = await import('../pr-callback-handler.js');
    // 修复前：只查 status='completed'，不查 completed_no_pr → 返回 null
    // 修复后：也查 completed_no_pr → 返回任务
    const task = await matchTaskByBranchOrUrl(mockPool, branchName, prUrl);
    expect(task).not.toBeNull();
    expect(task.status).toBe('completed_no_pr');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 场景 5: handlePrMerged — 按 prUrl 兜底匹配 + 终态字段
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../kr-progress.js', () => ({
  updateKrProgress: vi.fn().mockResolvedValue({}),
}));

describe('handlePrMerged — 按 prUrl 兜底匹配 completed_no_pr 任务', () => {
  beforeEach(() => vi.clearAllMocks());

  it('branchName 匹配不到时按 prUrl 找到 completed_no_pr 任务 → 写 pr_status=merged', async () => {
    const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4827';
    const branchName = 'cp-0812040300-unique-run-terminal-fix';

    const updatedRows = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return {};
        if (/UPDATE\s+tasks/i.test(sql)) {
          updatedRows.push({ sql, params });
          return {
            rowCount: 1,
            rows: [{ id: 'task-no-pr-state', goal_id: null, project_id: null, pr_url: prUrl, pr_merged_at: '2026-08-12T06:00:00Z' }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const pool = {
      query: vi.fn(async (sql, params) => {
        // in_progress by branch → 空（没有任务有这个 branch）
        if (/status\s*=\s*'in_progress'/i.test(sql) && /metadata.*branch|pr_branch/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        // in_progress by prUrl OR completed/completed_no_pr by prUrl → 返回任务
        if (params && params.some(p => String(p).includes('pull/4827'))) {
          return {
            rows: [{
              id: 'task-no-pr-state',
              title: 'fix PR #4827',
              status: 'completed_no_pr',
              project_id: null,
              goal_id: null,
              metadata: { branch: branchName },
              payload: { existing_pr_url: prUrl },
              task_type: 'dev',
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      connect: vi.fn(async () => client),
    };

    const { handlePrMerged } = await import('../pr-callback-handler.js');
    const result = await handlePrMerged(pool, {
      repo: 'perfectuser21/cecelia',
      prNumber: 4827,
      branchName,
      prUrl,
      mergedAt: '2026-08-12T06:00:00Z',
      title: 'fix(brain): existing PR authority',
    });

    // 修复前：matchTaskByBranchOrUrl 找不到任务 → matched=false
    // 修复后：按 prUrl 找到 → matched=true，UPDATE pr_status=merged
    expect(result.matched).toBe(true);
    expect(result.taskId).toBe('task-no-pr-state');

    // UPDATE 应包含 merged 终态
    const updateCall = updatedRows.find(r => /UPDATE\s+tasks/i.test(r.sql));
    expect(updateCall).toBeDefined();
    const sqlOrParams = updateCall.sql + JSON.stringify(updateCall.params || []);
    expect(/merged/i.test(sqlOrParams)).toBe(true);
  });

  it('幂等：同一 webhook 重放时 UPDATE rowCount=0 → 返回 matched=true 但跳过（无重复）', async () => {
    const prUrl = 'https://github.com/x/y/pull/10';
    const branchName = 'cp-abc';

    const updateCalls = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return {};
        if (/UPDATE\s+tasks/i.test(sql)) {
          updateCalls.push({ sql, params });
          // 模拟已处理（pr_merged_at 已有值，rowCount=0 → 幂等）
          return { rowCount: 0, rows: [] };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const pool = {
      query: vi.fn(async (sql) => {
        if (/status\s*=\s*'in_progress'/i.test(sql)) {
          return {
            rows: [{
              id: 'task-idempotent',
              title: '测试',
              status: 'in_progress',
              project_id: null,
              goal_id: null,
              metadata: { branch: branchName },
              payload: {},
              task_type: 'dev',
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      connect: vi.fn(async () => client),
    };

    const { handlePrMerged } = await import('../pr-callback-handler.js');
    const result = await handlePrMerged(pool, {
      repo: 'x/y',
      prNumber: 10,
      branchName,
      prUrl,
      mergedAt: '2026-08-12T06:00:00Z',
      title: 'idempotent test',
    });

    // 匹配到任务，但 UPDATE rowCount=0 → 幂等跳过
    expect(result.matched).toBe(true);
    // 不应触发 KR 进度（幂等路径）
    expect(result.krProgressUpdated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue B: 非法 URL 拒绝 — stdout 含无效 pr_url 时 _meta.pr_url 必须为 null
// （确认 Bug：docker-executor.js 中 `(stdoutPrUrl || null)` 会将无效 URL 写入）
// ─────────────────────────────────────────────────────────────────────────────
describe('writeDockerCallback — 非法 URL 必须被拒绝为 null', () => {
  function makeInvalidUrlPool() {
    const insertedRows = [];
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (/INSERT INTO callback_queue/i.test(sql)) {
          insertedRows.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      insertedRows,
    };
    return mockPool;
  }

  const baseTask = {
    task_type: 'dev',
    pr_url: null,
    payload: {},
  };

  const baseDockerResult = {
    exit_code: 0,
    timed_out: false,
    stderr: '',
    container: 'container-invalid',
    started_at: '2026-08-12T05:00:00Z',
    ended_at: '2026-08-12T05:05:00Z',
    duration_ms: 300000,
  };

  it('stdout pr_url: garbage → _meta.pr_url 必须为 null（已确认 bug: stdoutPrUrl || null 会保留无效值）', async () => {
    const pool = makeInvalidUrlPool();
    const task = { ...baseTask, id: 'task-invalid-garbage' };
    const result = { ...baseDockerResult, stdout: 'pr_url: garbage\n任务完成' };

    const { writeDockerCallback } = await import('../docker-executor.js');
    await writeDockerCallback(task, 'run-b1', null, result, pool);

    expect(pool.insertedRows.length).toBeGreaterThan(0);
    const resultJson = JSON.parse(pool.insertedRows[0].params[4]);
    // 修复前：_meta.pr_url = 'garbage'
    // 修复后：_meta.pr_url = null（非法 URL 被拒绝）
    expect(resultJson._meta.pr_url).toBeNull();
  });

  it('stdout pr_url: javascript:alert(1) → _meta.pr_url 必须为 null', async () => {
    const pool = makeInvalidUrlPool();
    const task = { ...baseTask, id: 'task-invalid-js' };
    const result = { ...baseDockerResult, stdout: 'pr_url: javascript:alert(1)' };

    const { writeDockerCallback } = await import('../docker-executor.js');
    await writeDockerCallback(task, 'run-b2', null, result, pool);

    expect(pool.insertedRows.length).toBeGreaterThan(0);
    const resultJson = JSON.parse(pool.insertedRows[0].params[4]);
    expect(resultJson._meta.pr_url).toBeNull();
  });

  it('stdout pr_url: https://gitlab.com/x/y/pull/1 (非 github.com URL) → _meta.pr_url 必须为 null', async () => {
    const pool = makeInvalidUrlPool();
    const task = { ...baseTask, id: 'task-invalid-gitlab' };
    const result = { ...baseDockerResult, stdout: 'pr_url: https://gitlab.com/x/y/pull/1\n完成' };

    const { writeDockerCallback } = await import('../docker-executor.js');
    await writeDockerCallback(task, 'run-b3', null, result, pool);

    expect(pool.insertedRows.length).toBeGreaterThan(0);
    const resultJson = JSON.parse(pool.insertedRows[0].params[4]);
    expect(resultJson._meta.pr_url).toBeNull();
  });

  it('stdout pr_url: https://github.com/x/y/issues/1 (非 PR URL) → _meta.pr_url 必须为 null', async () => {
    const pool = makeInvalidUrlPool();
    const task = { ...baseTask, id: 'task-invalid-issue' };
    const result = { ...baseDockerResult, stdout: 'pr_url: https://github.com/x/y/issues/1' };

    const { writeDockerCallback } = await import('../docker-executor.js');
    await writeDockerCallback(task, 'run-b4', null, result, pool);

    expect(pool.insertedRows.length).toBeGreaterThan(0);
    const resultJson = JSON.parse(pool.insertedRows[0].params[4]);
    expect(resultJson._meta.pr_url).toBeNull();
  });
});
