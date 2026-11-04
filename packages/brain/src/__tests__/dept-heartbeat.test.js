/**
 * dept-heartbeat.test.js
 *
 * 单元测试：getEnabledDepts / lookupDeptPrimaryGoal / createDeptHeartbeatTask / triggerDeptHeartbeats
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getEnabledDepts,
  lookupDeptPrimaryGoal,
  createDeptHeartbeatTask,
  triggerDeptHeartbeats,
} from '../dept-heartbeat.js';

// 隔离共享建单器及事件出站边界；本文件只验证 heartbeat 编排。
vi.mock('../actions.js', () => ({ createTask: vi.fn(async () => { throw new Error('必须注入任务创建边界'); }) }));
vi.mock('../incident-reporter.js', () => ({ reportIncident: vi.fn().mockResolvedValue(undefined) }));
import { reportIncident } from '../incident-reporter.js';

// ============================================================
// Mock pool（顺序响应模式：按调用顺序依次返回）
// ============================================================

function makePool(queryResponses) {
  const responses = [...queryResponses];
  const pool = {
    query: vi.fn(async (sql) => {
      const resp = responses.shift();
      if (resp instanceof Error) throw resp;
      return resp || { rows: [] };
    }),
  };
  pool.taskCreator = vi.fn(async () => {
    const resp = responses.shift();
    if (resp instanceof Error) throw resp;
    if (!resp?.rows?.[0]?.id) throw new Error('缺少建单夹具响应');
    return { task: resp.rows[0] };
  });
  return pool;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================
// getEnabledDepts
// ============================================================

describe('getEnabledDepts', () => {
  it('D1: 返回 enabled=true 的部门列表', async () => {
    const pool = makePool([
      { rows: [
        { dept_name: 'zenithjoy', max_llm_slots: 2, repo_path: '/home/xx/perfect21/zenithjoy/workspace' },
        { dept_name: 'creator',   max_llm_slots: 1, repo_path: '/home/xx/perfect21/creator' },
      ]},
    ]);
    const depts = await getEnabledDepts(pool);
    expect(depts).toHaveLength(2);
    expect(depts[0].dept_name).toBe('zenithjoy');
    expect(depts[1].dept_name).toBe('creator');
  });

  it('D2: 无部门时返回空数组', async () => {
    const pool = makePool([{ rows: [] }]);
    const depts = await getEnabledDepts(pool);
    expect(depts).toHaveLength(0);
  });

  it('D3: SQL 包含 dept_configs 表和 enabled=true 条件', async () => {
    const pool = makePool([{ rows: [] }]);
    await getEnabledDepts(pool);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('dept_configs');
    expect(sql).toContain('enabled = true');
  });

  it('D4: 数据库查询失败时抛出异常', async () => {
    const pool = makePool([new Error('connection refused')]);
    await expect(getEnabledDepts(pool)).rejects.toThrow('connection refused');
  });
});

// ============================================================
// lookupDeptPrimaryGoal
// ============================================================

describe('lookupDeptPrimaryGoal', () => {
  it('D5: 存在匹配 goal 时返回 goal_id', async () => {
    const pool = makePool([
      { rows: [{ id: 'goal-uuid-123' }] },
    ]);
    const result = await lookupDeptPrimaryGoal(pool, 'brain');
    expect(result).toBe('goal-uuid-123');
  });

  it('D6: 查询参数包含部门名称（新 OKR 表）', async () => {
    const pool = makePool([{ rows: [] }]);
    await lookupDeptPrimaryGoal(pool, 'zenithjoy');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('key_results');
    expect(sql).toContain("metadata->>'dept'");
    expect(params).toEqual(['zenithjoy']);
  });

  it('D7: 无匹配 goal 时返回 null', async () => {
    const pool = makePool([{ rows: [] }]);
    const result = await lookupDeptPrimaryGoal(pool, 'nonexistent');
    expect(result).toBeNull();
  });

  it('D8: 数据库异常时降级返回 null（不抛出）', async () => {
    const pool = makePool([new Error('table not found')]);
    const result = await lookupDeptPrimaryGoal(pool, 'brain');
    expect(result).toBeNull();
  });

  it('D9: 排除 completed/cancelled/canceled 状态的 goal', async () => {
    const pool = makePool([{ rows: [] }]);
    await lookupDeptPrimaryGoal(pool, 'brain');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('completed');
    expect(sql).toContain('cancelled');
    expect(sql).toContain('canceled');
    expect(sql).toContain('NOT IN');
  });
});

// ============================================================
// createDeptHeartbeatTask
// ============================================================

describe('createDeptHeartbeatTask', () => {
  const dept = {
    dept_name: 'zenithjoy',
    repo_path: '/home/xx/perfect21/zenithjoy/workspace',
    max_llm_slots: 2,
  };

  it('D10: 无活跃 heartbeat 时创建新 task', async () => {
    const pool = makePool([
      { rows: [] },                          // 无活跃 heartbeat
      { rows: [] },                          // lookupDeptPrimaryGoal -> null
      { rows: [{ id: 'task-uuid-001' }] },   // 共享建单器 返回 id
    ]);
    const result = await createDeptHeartbeatTask(pool, dept, pool.taskCreator);
    expect(result.created).toBe(true);
    expect(result.task_id).toBe('task-uuid-001');
    expect(pool.taskCreator).toHaveBeenCalledWith(expect.objectContaining({
      db: pool, task_type: 'dept_heartbeat', dept: 'zenithjoy',
      source: 'scheduler', allow_unscoped: true, trigger_source: 'brain_auto',
    }));
  });

  it('D11: 已有活跃 heartbeat 时跳过（幂等/防重复）', async () => {
    const pool = makePool([
      { rows: [{ id: 'existing-task' }] },   // 已存在 queued heartbeat
    ]);
    const result = await createDeptHeartbeatTask(pool, dept, pool.taskCreator);
    expect(result.created).toBe(false);
    expect(result.reason).toBe('already_active');
    expect(result.task_id).toBe('existing-task');
  });

  it('D12: 已有活跃 heartbeat 时不调用共享建单器', async () => {
    const pool = makePool([
      { rows: [{ id: 'existing-task' }] },
    ]);
    await createDeptHeartbeatTask(pool, dept, pool.taskCreator);
    // 只应调用 1 次查询（检查活跃 heartbeat），不调用共享建单器
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.taskCreator).not.toHaveBeenCalled();
  });

  it('D13: goal_id 为 null 时仍成功创建任务', async () => {
    const pool = makePool([
      { rows: [] },                          // 无活跃 heartbeat
      { rows: [] },                          // lookupDeptPrimaryGoal -> null
      { rows: [{ id: 'task-no-goal' }] },    // 共享建单器
    ]);
    const result = await createDeptHeartbeatTask(pool, dept, pool.taskCreator);
    expect(result.created).toBe(true);
    // 验证 共享建单器 的 goal_id 参数为 null
    const createInput = pool.taskCreator.mock.calls[0][0];
    expect(createInput.goal_id).toBeNull();
  });

  it('D14: 有匹配 goal 时绑定 goal_id', async () => {
    const goalId = 'goal-uuid-789';
    const pool = makePool([
      { rows: [] },                          // 无活跃 heartbeat
      { rows: [{ id: goalId }] },            // lookupDeptPrimaryGoal -> 有 goal
      { rows: [{ id: 'task-with-goal' }] },  // 共享建单器
    ]);
    const result = await createDeptHeartbeatTask(pool, dept, pool.taskCreator);
    expect(result.created).toBe(true);
    // 验证 共享建单器 的 goal_id 参数
    const createInput = pool.taskCreator.mock.calls[0][0];
    expect(createInput.goal_id).toBe(goalId);
  });

  it('D15: 共享建单器 包含正确的 payload JSON', async () => {
    const pool = makePool([
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 'task-payload' }] },
    ]);
    await createDeptHeartbeatTask(pool, dept, pool.taskCreator);
    // 获取 共享建单器 调用的参数
    const createInput = pool.taskCreator.mock.calls[0][0];
    const payload = createInput.payload;
    expect(payload).toEqual({
      dept_name: 'zenithjoy',
      repo_path: '/home/xx/perfect21/zenithjoy/workspace',
      max_llm_slots: 2,
    });
  });

  it('D16: 创建成功时输出日志', async () => {
    const pool = makePool([
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 'task-log-check' }] },
    ]);
    await createDeptHeartbeatTask(pool, dept, pool.taskCreator);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Created heartbeat task task-log-check')
    );
  });

  it('D17: 共享建单器 失败时抛出异常', async () => {
    const pool = makePool([
      { rows: [] },                          // 无活跃 heartbeat
      { rows: [] },                          // lookupDeptPrimaryGoal
      new Error('unique constraint'),        // 共享建单器 失败
    ]);
    await expect(createDeptHeartbeatTask(pool, dept, pool.taskCreator)).rejects.toThrow('unique constraint');
  });

  it('D18: title 包含部门名称', async () => {
    const pool = makePool([
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 'task-title' }] },
    ]);
    await createDeptHeartbeatTask(pool, dept, pool.taskCreator);
    const createInput = pool.taskCreator.mock.calls[0][0];
    const title = createInput.title;
    expect(title).toContain('zenithjoy');
    expect(title).toContain('heartbeat');
  });
});

// ============================================================
// triggerDeptHeartbeats
// ============================================================

describe('triggerDeptHeartbeats', () => {
  it('D19: 为 2 个部门各创建 heartbeat', async () => {
    const pool = makePool([
      // getEnabledDepts
      { rows: [
        { dept_name: 'zenithjoy', max_llm_slots: 2, repo_path: '/a' },
        { dept_name: 'creator',   max_llm_slots: 1, repo_path: '/b' },
      ]},
      // zenithjoy: 无活跃
      { rows: [] },
      // zenithjoy: lookupDeptPrimaryGoal
      { rows: [] },
      // zenithjoy: 共享建单器
      { rows: [{ id: 'task-1' }] },
      // creator: 无活跃
      { rows: [] },
      // creator: lookupDeptPrimaryGoal
      { rows: [] },
      // creator: 共享建单器
      { rows: [{ id: 'task-2' }] },
    ]);

    const result = await triggerDeptHeartbeats(pool, pool.taskCreator);
    expect(result.triggered).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.results).toHaveLength(2);
  });

  it('D20: results 包含每个部门的名称和创建状态', async () => {
    const pool = makePool([
      { rows: [
        { dept_name: 'zenithjoy', max_llm_slots: 2, repo_path: '/a' },
      ]},
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 'task-1' }] },
    ]);

    const result = await triggerDeptHeartbeats(pool, pool.taskCreator);
    expect(result.results[0].dept).toBe('zenithjoy');
    expect(result.results[0].created).toBe(true);
    expect(result.results[0].task_id).toBe('task-1');
  });

  it('D21: 有 1 个部门已活跃时跳过该部门', async () => {
    const pool = makePool([
      { rows: [
        { dept_name: 'zenithjoy', max_llm_slots: 2, repo_path: '/a' },
      ]},
      // zenithjoy: 已有活跃
      { rows: [{ id: 'old-task' }] },
    ]);

    const result = await triggerDeptHeartbeats(pool, pool.taskCreator);
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0].created).toBe(false);
    expect(result.results[0].reason).toBe('already_active');
  });

  it('D22: 混合场景 - 部分创建、部分跳过', async () => {
    const pool = makePool([
      { rows: [
        { dept_name: 'brain', max_llm_slots: 2, repo_path: '/brain' },
        { dept_name: 'engine', max_llm_slots: 1, repo_path: '/engine' },
      ]},
      // brain: 已有活跃
      { rows: [{ id: 'existing-brain' }] },
      // engine: 无活跃
      { rows: [] },
      // engine: lookupDeptPrimaryGoal
      { rows: [] },
      // engine: 共享建单器
      { rows: [{ id: 'new-engine' }] },
    ]);

    const result = await triggerDeptHeartbeats(pool, pool.taskCreator);
    expect(result.triggered).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].dept).toBe('brain');
    expect(result.results[0].created).toBe(false);
    expect(result.results[1].dept).toBe('engine');
    expect(result.results[1].created).toBe(true);
  });

  it('D23: 无活跃部门时返回全零结果', async () => {
    const pool = makePool([{ rows: [] }]);

    const result = await triggerDeptHeartbeats(pool, pool.taskCreator);
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('D24: DB 异常时不 throw，返回空结果并记录错误', async () => {
    const pool = makePool([
      new Error('DB connection lost'),
    ]);

    const result = await triggerDeptHeartbeats(pool, pool.taskCreator);
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.results).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('triggerDeptHeartbeats error'),
      'DB connection lost'
    );
  });

  it('D25: 单部门建单异常上报 incident 并记录跳过', async () => {
    const pool = makePool([
      { rows: [
        { dept_name: 'brain', max_llm_slots: 2, repo_path: '/brain' },
      ]},
      // brain: 无活跃
      { rows: [] },
      // brain: lookupDeptPrimaryGoal
      { rows: [] },
      // brain: 共享建单器 失败
      new Error('disk full'),
    ]);

    const result = await triggerDeptHeartbeats(pool, pool.taskCreator);
    expect(result).toEqual({ triggered: 0, skipped: 1,
      results: [{ dept: 'brain', created: false, reason: 'error' }] });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('createDeptHeartbeatTask error for brain'), 'disk full');
    expect(reportIncident).toHaveBeenCalledWith('dept-heartbeat', 'heartbeat-silent:brain',
      'p2', { dept_name: 'brain', error: 'disk full' });
  });

  it('D26: triggered > 0 时输出日志', async () => {
    const pool = makePool([
      { rows: [
        { dept_name: 'brain', max_llm_slots: 2, repo_path: '/brain' },
      ]},
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 'task-log' }] },
    ]);

    await triggerDeptHeartbeats(pool, pool.taskCreator);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Triggered 1 heartbeats')
    );
  });

  it('D27: triggered=0 时不输出 Triggered 日志', async () => {
    const pool = makePool([
      { rows: [
        { dept_name: 'brain', max_llm_slots: 2, repo_path: '/brain' },
      ]},
      // 已有活跃
      { rows: [{ id: 'existing' }] },
    ]);

    await triggerDeptHeartbeats(pool, pool.taskCreator);
    const triggerLogs = console.log.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('Triggered')
    );
    expect(triggerLogs).toHaveLength(0);
  });
});
