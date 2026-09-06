/**
 * harness-watchdog-never-started.test.js
 *
 * Regression test for Notion issue fabf6bd6 — harness dispatcher deadlock.
 *
 * Gap: resumeStalledHarnessDrivers() already recovers stalled graphs via heartbeat,
 * but every query requires an existing initiative_runs row (JOIN/EXISTS). A task
 * that never even got that far (claim succeeded, status=in_progress, but the graph
 * never invoked — matches the issue's `initiative_runs=0` symptom) is invisible to
 * both existing sections (A and B). This test covers the new "never started" branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockPoolConnect = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockPoolQuery, connect: mockPoolConnect },
}));

let resumeStalledHarnessDrivers;

function isNeverStartedCandidateSql(sql) {
  return /SELECT/i.test(sql)
    && /NOT\s+EXISTS/i.test(sql)
    && /initiative_runs/i.test(sql)
    && /claimed_at/i.test(sql);
}

function isTaskLockSql(sql) {
  return /FROM\s+tasks/i.test(sql) && /FOR\s+UPDATE/i.test(sql);
}

function isExactRunSql(sql) {
  return /FROM\s+initiative_runs/i.test(sql) && !/FROM\s+tasks/i.test(sql);
}

beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  mockPoolConnect.mockReset();
  mockPoolConnect.mockImplementation(async () => ({
    query: mockPoolQuery,
    release: vi.fn(),
  }));
  const mod = await import('../harness-watchdog.js');
  resumeStalledHarnessDrivers = mod.resumeStalledHarnessDrivers;
});

describe('resumeStalledHarnessDrivers — never-started branch (fabf6bd6)', () => {
  it('never-started 候选按版本感知身份排除 v2 current_task、v1 initiative 和无身份 legacy v2 run', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));

    await resumeStalledHarnessDrivers({});

    const candidateSql = mockPoolQuery.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => /claimed_at/i.test(sql) && /NOT\s+EXISTS/i.test(sql));
    expect(candidateSql).toBeDefined();
    expect(candidateSql).toMatch(
      /orchestrator_version\s*=\s*'v2'[\s\S]*current_task_id\s*=\s*t\.id/i,
    );
    expect(candidateSql).toMatch(
      /orchestrator_version\s*=\s*'v1'[\s\S]*initiative_id\s*=\s*t\.id/i,
    );
    expect(candidateSql).toMatch(
      /orchestrator_version\s*=\s*'v2'[\s\S]*current_task_id\s+IS\s+NULL[\s\S]*initiative_id\s*=\s*t\.id/i,
    );
  });

  it('候选后在独占 client 事务中锁 task、复核 exact run，确认无 run 才 UPDATE', async () => {
    const TASK_ID = 'aaaa1111-2222-4333-8444-555566667777';
    const events = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        const text = String(sql);
        if (/^BEGIN$/i.test(text)) events.push('begin');
        else if (isTaskLockSql(text)) {
          events.push('task-lock');
          expect(text).toMatch(/status/i);
          expect(text).toMatch(/claimed_at/i);
          expect(params).toContain(TASK_ID);
          return { rows: [{ id: TASK_ID, status: 'in_progress', claimed_at: new Date(0) }] };
        } else if (isExactRunSql(text)) {
          events.push('run-recheck');
          expect(params).toContain(TASK_ID);
          return { rows: [] };
        } else if (/UPDATE\s+tasks/i.test(text)) {
          events.push('update');
          return { rows: [{ id: TASK_ID }] };
        } else if (/^COMMIT$/i.test(text)) events.push('commit');
        else if (/^ROLLBACK$/i.test(text)) events.push('rollback');
        return { rows: [] };
      }),
      release: vi.fn(() => events.push('release')),
    };
    const dbPool = {
      query: vi.fn(async (sql) => {
        if (isNeverStartedCandidateSql(String(sql))) {
          events.push('candidate');
          return { rows: [{ id: TASK_ID }] };
        }
        return { rows: [] };
      }),
      connect: vi.fn(async () => {
        events.push('connect');
        return client;
      }),
    };
    const execFn = vi.fn(() => {
      events.push('docker');
      return '';
    });

    await resumeStalledHarnessDrivers({ pool: dbPool, execFn, maxFreshStarts: 3 });

    expect(events).toEqual([
      'candidate',
      'docker',
      'connect',
      'begin',
      'task-lock',
      'run-recheck',
      'update',
      'commit',
      'release',
    ]);
  });

  it('task 锁后出现 v2 exact run → 结束事务且不 UPDATE task', async () => {
    const TASK_ID = 'bbbb1111-2222-4333-8444-555566667777';
    const statements = [];
    const client = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        statements.push(text);
        if (isTaskLockSql(text)) {
          return { rows: [{ id: TASK_ID, status: 'in_progress', claimed_at: new Date(0) }] };
        }
        if (isExactRunSql(text)) {
          return {
            rows: [{
              id: 'bbbb2222-2222-4333-8444-555566667777',
              orchestrator_version: 'v2',
              current_task_id: TASK_ID,
            }],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const dbPool = {
      query: vi.fn(async (sql) => (
        isNeverStartedCandidateSql(String(sql))
          ? { rows: [{ id: TASK_ID }] }
          : { rows: [] }
      )),
      connect: vi.fn(async () => client),
    };

    const result = await resumeStalledHarnessDrivers({
      pool: dbPool,
      execFn: () => '',
      maxFreshStarts: 3,
    });

    const allStatements = [
      ...dbPool.query.mock.calls.map(([sql]) => String(sql)),
      ...statements,
    ];
    expect(statements.some(isExactRunSql)).toBe(true);
    expect(allStatements.some(sql => /UPDATE\s+tasks/i.test(sql))).toBe(false);
    expect(statements.some(sql => /^(COMMIT|ROLLBACK)$/i.test(sql))).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
    expect(result.resumed).not.toContain(TASK_ID);
  });

  it('共享 initiative 的 sibling v2 run 不会保护当前无 run task', async () => {
    const TASK_ID = 'cccc1111-2222-4333-8444-555566667777';
    const SIBLING_TASK_ID = 'cccc2222-2222-4333-8444-555566667777';
    const SHARED_INITIATIVE_ID = 'cccc3333-2222-4333-8444-555566667777';
    let exactRunSql = '';
    let updateCalled = false;
    const client = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        if (isTaskLockSql(text)) {
          return { rows: [{ id: TASK_ID, status: 'in_progress', claimed_at: new Date(0) }] };
        }
        if (isExactRunSql(text)) {
          exactRunSql = text;
          // 数据库里只有共享 initiative 的 sibling v2 run；精确身份查询应返回空。
          const siblingRun = {
            initiative_id: SHARED_INITIATIVE_ID,
            orchestrator_version: 'v2',
            current_task_id: SIBLING_TASK_ID,
          };
          expect(siblingRun.current_task_id).not.toBe(TASK_ID);
          return { rows: [] };
        }
        if (/UPDATE\s+tasks/i.test(text)) {
          updateCalled = true;
          return { rows: [{ id: TASK_ID }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const dbPool = {
      query: vi.fn(async (sql) => (
        isNeverStartedCandidateSql(String(sql))
          ? { rows: [{ id: TASK_ID }] }
          : { rows: [] }
      )),
      connect: vi.fn(async () => client),
    };

    const result = await resumeStalledHarnessDrivers({
      pool: dbPool,
      execFn: () => '',
      maxFreshStarts: 3,
    });

    expect(exactRunSql).toMatch(
      /orchestrator_version\s*=\s*'v2'[\s\S]*current_task_id\s*=\s*\$1/i,
    );
    expect(exactRunSql).toMatch(
      /orchestrator_version\s*=\s*'v2'[\s\S]*current_task_id\s+IS\s+NULL[\s\S]*initiative_id\s*=\s*\$1/i,
    );
    expect(updateCalled).toBe(true);
    expect(result.resumed).toContain(TASK_ID);
  });

  it('缺少 connect() 的 query-only pool 必须拒绝判死，不能伪造跨连接事务', async () => {
    const TASK_ID = 'dddd2222-2222-4333-8444-555566667777';
    const query = vi.fn(async (sql) => (
      isNeverStartedCandidateSql(String(sql))
        ? { rows: [{ id: TASK_ID }] }
        : { rows: [] }
    ));

    const result = await resumeStalledHarnessDrivers({
      pool: { query },
      execFn: () => '',
      maxFreshStarts: 3,
    });

    expect(query.mock.calls.some(([sql]) => /UPDATE\s+tasks/i.test(String(sql)))).toBe(false);
    expect(result.resumed).not.toContain(TASK_ID);
  });

  it('事务内 exact-run 复核失败时 ROLLBACK 并 release，任务不进入 resumed', async () => {
    const TASK_ID = 'eeee2222-2222-4333-8444-555566667777';
    const statements = [];
    const client = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        statements.push(text);
        if (isTaskLockSql(text)) {
          return { rows: [{ id: TASK_ID, status: 'in_progress', claimed_at: new Date(0) }] };
        }
        if (isExactRunSql(text)) throw new Error('forced exact-run read failure');
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const dbPool = {
      query: vi.fn(async (sql) => (
        isNeverStartedCandidateSql(String(sql))
          ? { rows: [{ id: TASK_ID }] }
          : { rows: [] }
      )),
      connect: vi.fn(async () => client),
    };

    const result = await resumeStalledHarnessDrivers({
      pool: dbPool,
      execFn: () => '',
      maxFreshStarts: 3,
    });

    expect(statements.some((sql) => /^ROLLBACK$/i.test(sql))).toBe(true);
    expect(statements.some((sql) => /UPDATE\s+tasks/i.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
    expect(result.resumed).not.toContain(TASK_ID);
  });

  it('SELECT 含 NOT EXISTS initiative_runs + claimed_at 陈旧判据', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers({});
    const allSql = mockPoolQuery.mock.calls.map(c => c[0]).join('\n');
    expect(allSql).toMatch(/NOT\s+EXISTS/i);
    expect(allSql).toMatch(/initiative_runs/);
    expect(allSql).toMatch(/claimed_at/i);
  });

  it('in_progress + 无 initiative_runs 行 + claimed_at 超过阈值(20min) → 标 failed + 释放 claim', async () => {
    const TASK_ID = 'cccc1111-2222-3333-4444-555566667777';
    let updateSql = '';
    let updateParams = [];
    mockPoolQuery.mockImplementation(async (sql, params) => {
      // scope tightly to the 区段 C "never started" SELECT — section A also has
      // NOT EXISTS + initiative_runs in its subquery, but only 区段 C also filters
      // on t.claimed_at, so require that too to avoid cross-matching section A.
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql) && /claimed_at/i.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (isTaskLockSql(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', claimed_at: new Date(0) }] };
      }
      if (isExactRunSql(sql)) return { rows: [] };
      if (/SELECT/i.test(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateSql = sql;
        updateParams = params;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });

    const r = await resumeStalledHarnessDrivers({});

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(updateSql).toMatch(/claimed_by\s*=\s*NULL/i);
    expect(updateParams.join(' ')).toContain(TASK_ID);
    // must be counted somewhere in the return value (resumed or a dedicated field)
    expect(JSON.stringify(r)).toContain(TASK_ID);
  });

  it('刚 claim 不久（claimed_at 1 分钟前）→ 不动它（不是 never-started 野鬼，是正常起步中）', async () => {
    mockPoolQuery.mockImplementation(async (sql) => {
      // simulate: the never-started SELECT itself applies the staleness filter in SQL,
      // so a fresh claim never even appears in rows — return empty for that query.
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const r = await resumeStalledHarnessDrivers({});
    expect(r.resumed).toEqual([]);
  });

  // ── 容器存活探测（07-19 bug fix）────────────────────────────────────────
  // 真实事故：本次对话内实测复现4次——claude-headed-smoke/GP-A补齐触发入口/
  // 两次headless-smoke——都是容器慢启动或前台接管，claimed_at超过20分钟阈值
  // 但没来得及写initiative_runs首行，被区段C无差别标failed、清空claim，触发
  // 重新完整派发（产出多个重复PR）。修法：判死前先探测docker ps，容器还活着
  // 就不判死，留给下次tick再看——复用harness-relay-watchdog.js:331已验证过的
  // `docker ps -q --filter "name=cecelia-relay-${short}"` 模式。

  it('容器仍在跑（docker ps 探测到）→ 不判死，不清空 claim', async () => {
    const TASK_ID = 'dddd1111-2222-3333-4444-555566667777';
    let updateCalled = false;
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql) && /claimed_at/i.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateCalled = true;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });
    // 容器仍在跑：docker ps -q 返回非空容器 ID
    const execFn = vi.fn(() => 'abc123def456\n');

    const r = await resumeStalledHarnessDrivers({ execFn });

    expect(execFn).toHaveBeenCalledWith(expect.stringMatching(/docker ps -q --filter/));
    expect(updateCalled).toBe(false);
    expect(r.resumed).toEqual([]);
  });

  it('容器已退出（docker ps 探测为空）→ 保留现有判死逻辑，标 failed', async () => {
    const TASK_ID = 'eeee1111-2222-3333-4444-555566667777';
    let updateSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql) && /claimed_at/i.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (isTaskLockSql(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', claimed_at: new Date(0) }] };
      }
      if (isExactRunSql(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateSql = sql;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });
    // 容器已退出：docker ps -q 返回空字符串
    const execFn = vi.fn(() => '');

    const r = await resumeStalledHarnessDrivers({ execFn });

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(r.resumed).toContain(TASK_ID);
  });

  // ── 有头豁免（并行血管P2，decision 45a2bcfb）──────────────────────────────
  // 真实事故：09-06 战役中误杀 4 次——有头 /dev 会话（claimed_by=interactive-dev-skill）
  // 在 PrepPRD/探索/TDD 阶段 20min 内不写 initiative_runs 行，被区段 C 无差别标 failed
  // 清 claim 触发重复派发。docker 容器探测救不了有头（有头没有 cecelia-relay-* 容器）。
  // 修法：claimed_by 含 interactive-dev-skill 且 claimed_at < 40min（HEADED_CLAIM_GRACE_MINUTES）
  // → 视为有头在工跳过；超 40min 无任何 run 活动才落回判死。候选 SELECT 与事务锁双处谓词（防 TOCTOU）。

  it('候选 SELECT 含 interactive-dev-skill 有头豁免谓词 + 40 分钟宽限窗', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers({});
    const candidateSql = mockPoolQuery.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => isNeverStartedCandidateSql(sql));
    expect(candidateSql).toBeDefined();
    expect(candidateSql).toMatch(/interactive-dev-skill/);
    expect(candidateSql).toMatch(/claimed_by/i);
    expect(candidateSql).toMatch(/40\s*minutes|\$\d+\s*\|\|\s*' minutes'/i);
  });

  it('事务内 FOR UPDATE 锁查询同样含有头豁免谓词（防 claim 后被刷新的 TOCTOU）', async () => {
    const TASK_ID = 'a795594b-1111-4222-8333-444455556666';
    let lockSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      if (isNeverStartedCandidateSql(String(sql))) return { rows: [{ id: TASK_ID }] };
      if (isTaskLockSql(String(sql))) {
        lockSql = String(sql);
        return { rows: [] }; // 锁时已被豁免谓词过滤掉
      }
      return { rows: [] };
    });
    await resumeStalledHarnessDrivers({ execFn: () => '' });
    expect(lockSql).toMatch(/interactive-dev-skill/);
  });

  it('claimed 20min 的有头任务（claimed_by=interactive-dev-skill）→ 不标 failed 不清 claim', async () => {
    // 模拟 DB 正确执行豁免谓词：有头新鲜任务不出现在候选/锁结果里
    const HEADED_TASK = { id: 'a795594b-2222-4333-8444-555566667777', claimed_by: 'interactive-dev-skill', claimed_at: new Date(Date.now() - 20 * 60 * 1000) };
    let updateCalled = false;
    mockPoolQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (isNeverStartedCandidateSql(text)) {
        // DB 执行豁免谓词：claimed_by 含 interactive-dev-skill 且 claimed_at 20min < 40min → 过滤
        const exempt = /interactive-dev-skill/.test(text);
        return { rows: exempt ? [] : [{ id: HEADED_TASK.id }] };
      }
      if (isTaskLockSql(text)) return { rows: [{ id: HEADED_TASK.id, status: 'in_progress', claimed_at: HEADED_TASK.claimed_at }] };
      if (isExactRunSql(text)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(text)) { updateCalled = true; return { rows: [{ id: HEADED_TASK.id }] }; }
      return { rows: [] };
    });

    const r = await resumeStalledHarnessDrivers({ execFn: () => '' });

    expect(updateCalled).toBe(false);
    expect(r.resumed).toEqual([]);
  });

  it('claimed 超 40min 的有头任务 → 豁免失效，落回原判死逻辑标 failed', async () => {
    const STALE_HEADED = 'a795594b-3333-4444-8555-666677778888';
    let updateSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (isNeverStartedCandidateSql(text)) {
        // DB 执行豁免谓词：claimed_at 50min > 40min → 豁免不成立，进候选
        return { rows: [{ id: STALE_HEADED }] };
      }
      if (isTaskLockSql(text)) {
        return { rows: [{ id: STALE_HEADED, status: 'in_progress', claimed_at: new Date(Date.now() - 50 * 60 * 1000) }] };
      }
      if (isExactRunSql(text)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(text)) { updateSql = text; return { rows: [{ id: STALE_HEADED }] }; }
      return { rows: [] };
    });

    const r = await resumeStalledHarnessDrivers({ execFn: () => '' });

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(r.resumed).toContain(STALE_HEADED);
  });

  it('HEADED_CLAIM_GRACE_MINUTES 常量导出为 40', async () => {
    const mod = await import('../harness-watchdog.js');
    expect(mod.HEADED_CLAIM_GRACE_MINUTES).toBe(40);
  });

  it('docker 命令失败（不可用）→ fail-open 保留现有判死逻辑，不因探测失败而漏判真死亡任务', async () => {
    const TASK_ID = 'ffff1111-2222-3333-4444-555566667777';
    let updateSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql) && /claimed_at/i.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (isTaskLockSql(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', claimed_at: new Date(0) }] };
      }
      if (isExactRunSql(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateSql = sql;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });
    const execFn = vi.fn(() => { throw new Error('docker: command not found'); });

    const r = await resumeStalledHarnessDrivers({ execFn });

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(r.resumed).toContain(TASK_ID);
  });
});
