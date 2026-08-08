/**
 * D4 后端合同测试（failing tests — 按 FR-6 要求先行入库）
 *
 * 覆盖五条 invariant：
 *   FR-1: adjudication 400 校验（缺字段 / 非法 verdict）
 *   FR-2: unverifiable_this_version 例外不开 P0
 *   FR-3: 哑火路径不进熔断
 *   FR-4: adjudicated/stale 状态 abandon → 409
 *   FR-5: SAVEPOINT 保护 23505 不毒化外层事务
 *
 * 这些测试在 D4 功能代码实现前 **预期失败**。
 * 实现完成后全部应通过，永久留在 CI 回归套件中不可删除。
 *
 * 路由：PATCH /api/brain/acceptance/runs/:run_key/checks/:check_key/adjudicate
 *       PATCH /api/brain/acceptance/runs/:run_key/adjudicate-run
 *       PATCH /api/brain/acceptance/runs/:run_key/abandon
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// D4 功能代码完成后这个 import 应能正常 resolve。
// 测试阶段不存在该导出时，vitest 会在 describe 外报 import error，
// 届时用 try/catch dynamic import + skip 保护即可。
let createAcceptanceInternalRouter;
try {
  ({ createAcceptanceInternalRouter } = await import(
    '../../../packages/brain/src/routes/acceptance.js'
  ));
} catch {
  createAcceptanceInternalRouter = null;
}

// ─── 测试辅助 ───────────────────────────────────────────────────────────────

function makeApp(pool) {
  if (!createAcceptanceInternalRouter) {
    throw new Error('createAcceptanceInternalRouter 尚未实现（D4 功能代码未就绪）');
  }
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

/** 构造 mock pg client，scripts 是 (sql, params) => result 的映射函数 */
function makeClient(scripts) {
  const query = vi.fn(async (sql, params) => scripts(sql, params) ?? { rows: [] });
  return { query, release: vi.fn() };
}

function makePool(client) {
  return { connect: vi.fn(async () => client), query: vi.fn() };
}

// 一个已存在的 acceptance_run（status='pending'，无 adjudication）
const BASE_RUN = {
  id: 'run-uuid-d4',
  run_key: 'test-run-d4',
  status: 'pending',
  detail: {},
};

// ─── FR-1: adjudication 400 校验 ─────────────────────────────────────────────

describe('FR-1: PATCH /runs/:run_key/checks/:check_key/adjudicate — 400 校验', () => {
  function makePoolForAdjudicate(runStatus = 'human_complete', adjudication = null) {
    const run = { ...BASE_RUN, status: runStatus, detail: {} };
    const check = { id: 'chk-1', check_key: 'S1-c1', run_id: run.id, adjudication };
    const client = makeClient((sql) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id/i.test(sql)) return { rows: [check] };
      if (/UPDATE acceptance_checks/i.test(sql)) return { rows: [{ ...check }] };
      if (/UPDATE acceptance_runs/i.test(sql)) return { rows: [run] };
    });
    return makePool(client);
  }

  it('[BEHAVIOR-1] 缺 verdict 字段 → HTTP 400', async () => {
    const app = makeApp(makePoolForAdjudicate());
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-d4/checks/S1-c1/adjudicate')
      .set('Authorization', 'Bearer test-token')
      .send({ by: 'staff-1', reason: '理由' });
    expect(res.status).toBe(400);
  });

  it('[BEHAVIOR-1] 缺 by 字段 → HTTP 400', async () => {
    const app = makeApp(makePoolForAdjudicate());
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-d4/checks/S1-c1/adjudicate')
      .set('Authorization', 'Bearer test-token')
      .send({ verdict: '绿', reason: '理由' });
    expect(res.status).toBe(400);
  });

  it('[BEHAVIOR-1] 缺 reason 字段 → HTTP 400', async () => {
    const app = makeApp(makePoolForAdjudicate());
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-d4/checks/S1-c1/adjudicate')
      .set('Authorization', 'Bearer test-token')
      .send({ verdict: '绿', by: 'staff-1' });
    expect(res.status).toBe(400);
  });

  it('[BEHAVIOR-1] verdict 非法值（非绿/红）→ HTTP 400', async () => {
    const app = makeApp(makePoolForAdjudicate());
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-d4/checks/S1-c1/adjudicate')
      .set('Authorization', 'Bearer test-token')
      .send({ verdict: 'pass', by: 'staff-1', reason: '理由' });
    expect(res.status).toBe(400);
  });

  it('[BEHAVIOR-1] 合法请求 → HTTP 200，adjudication 含四字段', async () => {
    let writtenAdjudication = null;
    const run = { ...BASE_RUN, status: 'human_complete' };
    const check = { id: 'chk-1', check_key: 'S1-c1', run_id: run.id, adjudication: null, scenario_class: 'normal' };
    const client = makeClient((sql, params) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id.*AND check_key/i.test(sql)) return { rows: [check] };
      if (/UPDATE acceptance_checks/i.test(sql)) {
        // params[0] 是 adjudication JSON
        writtenAdjudication = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
        return { rows: [{ ...check, adjudication: writtenAdjudication }] };
      }
      if (/UPDATE acceptance_runs/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id/i.test(sql)) return { rows: [check] };
      if (/INSERT INTO tasks/i.test(sql)) return { rows: [{ id: 'task-1' }] };
    });
    const app = makeApp(makePool(client));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-d4/checks/S1-c1/adjudicate')
      .set('Authorization', 'Bearer test-token')
      .send({ verdict: '绿', by: 'staff-1', reason: '确认通过' });
    expect(res.status).toBe(200);
    expect(writtenAdjudication).not.toBeNull();
    expect(writtenAdjudication.verdict).toBe('绿');
    expect(writtenAdjudication.by).toBe('staff-1');
    expect(writtenAdjudication.reason).toBe('确认通过');
    expect(writtenAdjudication.at).toBeTruthy();
    // at 应为 ISO 8601
    expect(new Date(writtenAdjudication.at).getTime()).toBeGreaterThan(0);
  });
});

// ─── FR-2: unverifiable_this_version 例外 ────────────────────────────────────

describe('FR-2: hard 格裁决绿 — unverifiable_this_version 例外不开 P0', () => {
  it('[BEHAVIOR-2] scenario_class=unverifiable_this_version → 不建 hard_green_p0 任务', async () => {
    const run = { ...BASE_RUN, status: 'human_complete', detail: {} };
    const check = {
      id: 'chk-uv',
      check_key: 'S13-c4',
      run_id: run.id,
      adjudication: null,
      // hard:true 但 scenario_class = 'unverifiable_this_version'
      scenario_class: 'unverifiable_this_version',
      is_hard: true,
    };
    const insertedTasks = [];
    let unverifiableUpdated = false;

    const client = makeClient((sql, params) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id.*AND check_key/i.test(sql)) return { rows: [check] };
      if (/UPDATE acceptance_checks/i.test(sql)) return { rows: [{ ...check }] };
      if (/UPDATE acceptance_runs.*unverifiable_adjudicated/i.test(sql)) {
        unverifiableUpdated = true;
        return { rows: [run] };
      }
      if (/UPDATE acceptance_runs/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id/i.test(sql)) return { rows: [check] };
      if (/INSERT INTO tasks/i.test(sql)) {
        // params 中应含 acceptance_bucket
        const payloadStr = params?.find?.((p) => typeof p === 'string' && p.includes('acceptance_bucket')) ?? '';
        insertedTasks.push(payloadStr);
        return { rows: [{ id: 'task-uv' }] };
      }
    });

    const app = makeApp(makePool(client));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-d4/checks/S13-c4/adjudicate')
      .set('Authorization', 'Bearer test-token')
      .send({ verdict: '绿', by: 'staff-1', reason: '无法验证' });

    expect(res.status).toBe(200);
    // 不应建 hard_green_p0 任务
    const p0Tasks = insertedTasks.filter((p) => p.includes('hard_green_p0'));
    expect(p0Tasks).toHaveLength(0);
  });

  it('[BEHAVIOR-2] scenario_class 非 unverifiable → 建 hard_green_p0 任务', async () => {
    const run = { ...BASE_RUN, status: 'human_complete', detail: {} };
    const check = {
      id: 'chk-hard',
      check_key: 'S1-c1',
      run_id: run.id,
      adjudication: null,
      scenario_class: 'normal',
      is_hard: true,
    };
    const insertedBuckets = [];

    const client = makeClient((sql, params) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id.*AND check_key/i.test(sql)) return { rows: [check] };
      if (/UPDATE acceptance_checks/i.test(sql)) return { rows: [{ ...check }] };
      if (/UPDATE acceptance_runs/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id/i.test(sql)) return { rows: [check] };
      if (/SELECT.*tasks.*WHERE.*acceptance_run_key/i.test(sql)) return { rows: [] }; // 无重复
      if (/INSERT INTO tasks/i.test(sql)) {
        const payloadStr = params?.find?.((p) => typeof p === 'string' && p.includes('acceptance_bucket')) ?? '';
        if (payloadStr.includes('hard_green_p0')) insertedBuckets.push('hard_green_p0');
        return { rows: [{ id: 'task-p0' }] };
      }
    });

    const app = makeApp(makePool(client));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-d4/checks/S1-c1/adjudicate')
      .set('Authorization', 'Bearer test-token')
      .send({ verdict: '绿', by: 'staff-1', reason: '确认通过' });

    expect(res.status).toBe(200);
    expect(insertedBuckets).toContain('hard_green_p0');
  });
});

// ─── FR-3: 哑火路径不进熔断 ─────────────────────────────────────────────────

describe('FR-3: PATCH /runs/:run_key/adjudicate-run — 哑火路径', () => {
  it('[BEHAVIOR-3] ai_status=dumb → 建 infra_error P0，不建 bug/trace/fission', async () => {
    const run = {
      id: 'run-dumb-uuid',
      run_key: 'test-run-dumb',
      status: 'human_complete',
      detail: { ai_status: 'dumb' },
    };
    // 36 格，大量红格（> 1/3）但因 dumb 路径不应进熔断
    const checks = Array.from({ length: 36 }, (_, i) => ({
      id: `chk-${i}`,
      check_key: `S${Math.floor(i / 4) + 1}-c${(i % 4) + 1}`,
      run_id: run.id,
      adjudication: { verdict: '红', by: 'staff', reason: 'x', at: new Date().toISOString() },
      scenario_class: 'normal',
      is_hard: false,
    }));

    const insertedBuckets = [];
    const insertedPriorities = [];
    const client = makeClient((sql, params) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id/i.test(sql)) return { rows: checks };
      if (/UPDATE acceptance_runs/i.test(sql)) return { rows: [{ ...run, status: 'adjudicated' }] };
      if (/SELECT.*tasks.*WHERE.*acceptance_run_key/i.test(sql)) return { rows: [] };
      if (/INSERT INTO tasks/i.test(sql)) {
        const payloadStr = params?.find?.((p) => typeof p === 'string' && p.includes('acceptance_bucket')) ?? '';
        const m = payloadStr.match(/"acceptance_bucket"\s*:\s*"([^"]+)"/);
        if (m) insertedBuckets.push(m[1]);
        // 捕获 priority 字段（可能作为独立列或在 payload 中）
        const priorityParam = params?.find?.((p) => p === 'P0') ?? null;
        const priorityInPayload = payloadStr.match(/"priority"\s*:\s*"([^"]+)"/)?.[1] ?? null;
        insertedPriorities.push(priorityParam ?? priorityInPayload ?? params?.[3] ?? null);
        return { rows: [{ id: `task-${insertedBuckets.length}` }] };
      }
    });

    const app = makeApp(makePool(client));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-dumb/adjudicate-run')
      .set('Authorization', 'Bearer test-token')
      .send({ by: 'adjudicator-1' });

    expect(res.status).toBe(200);
    expect(insertedBuckets).toContain('infra_error');
    expect(insertedBuckets).not.toContain('bug');
    expect(insertedBuckets).not.toContain('trace');
    expect(insertedBuckets).not.toContain('fission');
    // infra_error 路径建 1 个 P0
    expect(insertedBuckets.filter((b) => b === 'infra_error')).toHaveLength(1);
    // infra_error 任务必须是 P0（通过 priority 列或 payload 中的 priority 字段验证）
    expect(insertedPriorities.some((p) => p === 'P0')).toBe(true);
  });

  it('[BEHAVIOR-3] 非绿格 > 1/3 → 建 fission P0，不建 bug/trace', async () => {
    const run = {
      id: 'run-fission-uuid',
      run_key: 'test-run-fission',
      status: 'human_complete',
      detail: {},
    };
    // 13 个红格（> 36*1/3=12），触发熔断
    const checks = Array.from({ length: 36 }, (_, i) => ({
      id: `chk-fs-${i}`,
      check_key: `S${Math.floor(i / 4) + 1}-c${(i % 4) + 1}`,
      run_id: run.id,
      adjudication: i < 13
        ? { verdict: '红', by: 'staff', reason: 'fail', at: new Date().toISOString() }
        : { verdict: '绿', by: 'staff', reason: 'ok', at: new Date().toISOString() },
      scenario_class: 'normal',
      is_hard: false,
    }));

    const insertedBuckets = [];
    const insertedPriorities = [];
    const client = makeClient((sql, params) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id/i.test(sql)) return { rows: checks };
      if (/UPDATE acceptance_runs/i.test(sql)) return { rows: [{ ...run, status: 'adjudicated' }] };
      if (/SELECT.*tasks.*WHERE.*acceptance_run_key/i.test(sql)) return { rows: [] };
      if (/INSERT INTO tasks/i.test(sql)) {
        const payloadStr = params?.find?.((p) => typeof p === 'string' && p.includes('acceptance_bucket')) ?? '';
        const m = payloadStr.match(/"acceptance_bucket"\s*:\s*"([^"]+)"/);
        if (m) insertedBuckets.push(m[1]);
        const priorityParam = params?.find?.((p) => p === 'P0') ?? null;
        const priorityInPayload = payloadStr.match(/"priority"\s*:\s*"([^"]+)"/)?.[1] ?? null;
        insertedPriorities.push(priorityParam ?? priorityInPayload ?? params?.[3] ?? null);
        return { rows: [{ id: `task-fs-${insertedBuckets.length}` }] };
      }
    });

    const app = makeApp(makePool(client));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-fission/adjudicate-run')
      .set('Authorization', 'Bearer test-token')
      .send({ by: 'adjudicator-1' });

    expect(res.status).toBe(200);
    expect(insertedBuckets).toContain('fission');
    expect(insertedBuckets).not.toContain('bug');
    expect(insertedBuckets).not.toContain('trace');
    // fission 任务必须是 P0
    expect(insertedBuckets.filter((b) => b === 'fission')).toHaveLength(1);
    expect(insertedPriorities.some((p) => p === 'P0')).toBe(true);
  });

  it('[BEHAVIOR-3] 正常分流（有红格）→ bug 任务 = 1，trace 任务 ≤ 1', async () => {
    const run = {
      id: 'run-normal-uuid',
      run_key: 'test-run-normal',
      status: 'human_complete',
      detail: {},
    };
    // 1 个红格（占比 1/36 < 1/3，不触发熔断）；1 个 trace_q4 格
    const checks = Array.from({ length: 36 }, (_, i) => ({
      id: `chk-nm-${i}`,
      check_key: `S${Math.floor(i / 4) + 1}-c${(i % 4) + 1}`,
      run_id: run.id,
      adjudication: i === 0
        ? { verdict: '红', by: 'staff', reason: 'fail', at: new Date().toISOString() }
        : { verdict: '绿', by: 'staff', reason: 'ok', at: new Date().toISOString() },
      scenario_class: i === 6 ? 'trace_q4' : 'normal',
      is_hard: false,
    }));

    const insertedBuckets = [];
    const client = makeClient((sql, params) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id/i.test(sql)) return { rows: checks };
      if (/SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT/i.test(sql)) return { rows: [] };
      if (/SELECT.*tasks.*WHERE.*acceptance_run_key/i.test(sql)) return { rows: [] };
      if (/INSERT INTO tasks/i.test(sql)) {
        const payloadStr = params?.find?.((p) => typeof p === 'string' && p.includes('acceptance_bucket')) ?? '';
        const m = payloadStr.match(/"acceptance_bucket"\s*:\s*"([^"]+)"/);
        if (m) insertedBuckets.push(m[1]);
        return { rows: [{ id: `task-nm-${insertedBuckets.length}` }] };
      }
      if (/UPDATE acceptance_runs/i.test(sql)) return { rows: [{ ...run, status: 'adjudicated' }] };
    });

    const app = makeApp(makePool(client));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-normal/adjudicate-run')
      .set('Authorization', 'Bearer test-token')
      .send({ by: 'adjudicator-1' });

    expect(res.status).toBe(200);
    // 有红格时 bug 任务必须 = 1（下界断言）
    expect(insertedBuckets.filter((b) => b === 'bug')).toHaveLength(1);
    // trace 任务上界 ≤ 1
    expect(insertedBuckets.filter((b) => b === 'trace').length).toBeLessThanOrEqual(1);
    // 不触发熔断
    expect(insertedBuckets).not.toContain('fission');
    expect(insertedBuckets).not.toContain('infra_error');
  });
});

// ─── FR-4: abandon 前态守卫 ─────────────────────────────────────────────────

describe('FR-4: PATCH /runs/:run_key/abandon — 前态守卫', () => {
  function makePoolForAbandon(currentStatus) {
    const run = { id: 'run-abandon-uuid', run_key: 'test-run-abandon', status: currentStatus, detail: {} };
    const client = makeClient((sql, params) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/UPDATE.*acceptance_runs.*abandoned/i.test(sql)) {
        // 只有允许 abandon 的状态才返回 row
        if (['adjudicated', 'stale'].includes(currentStatus)) return { rows: [] };
        return { rows: [{ ...run, status: 'abandoned' }] };
      }
    });
    return makePool(client);
  }

  it('[BEHAVIOR-4] status=adjudicated → PATCH /abandon → HTTP 409', async () => {
    const app = makeApp(makePoolForAbandon('adjudicated'));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-abandon/abandon')
      .set('Authorization', 'Bearer test-token')
      .send({ reason: '测试', by: 'user-1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('cannot_abandon');
    expect(res.body.current_status).toBe('adjudicated');
  });

  it('[BEHAVIOR-4] status=stale → PATCH /abandon → HTTP 409', async () => {
    const app = makeApp(makePoolForAbandon('stale'));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-abandon/abandon')
      .set('Authorization', 'Bearer test-token')
      .send({ reason: '测试', by: 'user-1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('cannot_abandon');
    expect(res.body.current_status).toBe('stale');
  });

  it('[BEHAVIOR-4] status=pending → PATCH /abandon → HTTP 200', async () => {
    const app = makeApp(makePoolForAbandon('pending'));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-abandon/abandon')
      .set('Authorization', 'Bearer test-token')
      .send({ reason: '测试', by: 'user-1' });
    expect(res.status).toBe(200);
  });

  it('[BEHAVIOR-4] status=in_review → PATCH /abandon → HTTP 200', async () => {
    const app = makeApp(makePoolForAbandon('in_review'));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-abandon/abandon')
      .set('Authorization', 'Bearer test-token')
      .send({ reason: '测试', by: 'user-1' });
    expect(res.status).toBe(200);
  });

  it('[BEHAVIOR-4] status=expired → PATCH /abandon → HTTP 200', async () => {
    const app = makeApp(makePoolForAbandon('expired'));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-abandon/abandon')
      .set('Authorization', 'Bearer test-token')
      .send({ reason: '测试', by: 'user-1' });
    expect(res.status).toBe(200);
  });
});

// ─── FR-5: SAVEPOINT 保护 23505 不毒化外层事务 ───────────────────────────────

describe('FR-5: SAVEPOINT — 23505 冲突不毒化外层事务', () => {
  it('[BEHAVIOR-5] 同 run_key+bucket 已存在任务 → SAVEPOINT 捕获冲突，外层事务正常提交', async () => {
    const run = {
      id: 'run-sp-uuid',
      run_key: 'test-run-savepoint',
      status: 'human_complete',
      detail: {},
    };
    // 一个红格：会触发 bug bucket 建单
    const checks = [
      {
        id: 'chk-sp-1',
        check_key: 'S1-c1',
        run_id: run.id,
        adjudication: { verdict: '红', by: 'staff', reason: 'x', at: new Date().toISOString() },
        scenario_class: 'normal',
        is_hard: false,
      },
      ...Array.from({ length: 35 }, (_, i) => ({
        id: `chk-sp-${i + 2}`,
        check_key: `S${Math.floor((i + 1) / 4) + 2}-c${((i + 1) % 4) + 1}`,
        run_id: run.id,
        adjudication: { verdict: '绿', by: 'staff', reason: 'ok', at: new Date().toISOString() },
        scenario_class: 'normal',
        is_hard: false,
      })),
    ];

    let savepointUsed = false;
    let outerRunUpdated = false;
    let insertAttempts = 0;
    let insertConflictHandled = false;

    const client = makeClient((sql, params) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id/i.test(sql)) return { rows: checks };
      if (/SAVEPOINT/i.test(sql)) {
        savepointUsed = true;
        return { rows: [] };
      }
      if (/ROLLBACK TO SAVEPOINT/i.test(sql)) {
        insertConflictHandled = true;
        return { rows: [] };
      }
      if (/RELEASE SAVEPOINT/i.test(sql)) return { rows: [] };
      if (/SELECT.*tasks.*WHERE.*acceptance_run_key/i.test(sql)) {
        // 模拟已有 bug bucket 任务（会触发 23505）
        return { rows: [{ id: 'existing-task', status: 'pending' }] };
      }
      if (/INSERT INTO tasks/i.test(sql)) {
        insertAttempts++;
        // 模拟 23505 重复键冲突
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      if (/UPDATE acceptance_runs.*status.*adjudicated/i.test(sql)) {
        outerRunUpdated = true;
        return { rows: [{ ...run, status: 'adjudicated' }] };
      }
      if (/UPDATE acceptance_runs/i.test(sql)) {
        outerRunUpdated = true;
        return { rows: [{ ...run, status: 'adjudicated' }] };
      }
    });

    const app = makeApp(makePool(client));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-savepoint/adjudicate-run')
      .set('Authorization', 'Bearer test-token')
      .send({ by: 'adjudicator-1' });

    // 外层 API 不应报错
    expect(res.status).toBe(200);
    // SAVEPOINT 应被使用
    expect(savepointUsed).toBe(true);
    // run 状态应正确更新
    expect(outerRunUpdated).toBe(true);
  });

  it('[BEHAVIOR-5] 两个不同 bucket 各自独立建任务（查重按 bucket 维度区分）', async () => {
    const run = {
      id: 'run-bucket-uuid',
      run_key: 'test-run-bucket',
      status: 'human_complete',
      detail: {},
    };
    // 构造有红格（触发 bug）和 Q4/Q7 格（触发 trace）
    const checks = Array.from({ length: 36 }, (_, i) => ({
      id: `chk-bk-${i}`,
      check_key: `S${Math.floor(i / 4) + 1}-c${(i % 4) + 1}`,
      run_id: run.id,
      adjudication: i === 0
        ? { verdict: '红', by: 'staff', reason: 'fail', at: new Date().toISOString() }
        : { verdict: '绿', by: 'staff', reason: 'ok', at: new Date().toISOString() },
      scenario_class: i === 6 ? 'trace_q4' : 'normal', // Q4 格触发 trace
      is_hard: false,
    }));

    const insertedBuckets = [];
    const client = makeClient((sql, params) => {
      if (/SELECT.*acceptance_runs.*WHERE run_key/i.test(sql)) return { rows: [run] };
      if (/SELECT.*acceptance_checks.*WHERE run_id/i.test(sql)) return { rows: checks };
      if (/SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT/i.test(sql)) return { rows: [] };
      if (/SELECT.*tasks.*WHERE.*acceptance_run_key.*acceptance_bucket/i.test(sql)) {
        // 无已有任务，两个 bucket 都能建
        return { rows: [] };
      }
      if (/INSERT INTO tasks/i.test(sql)) {
        const payloadStr = params?.find?.((p) => typeof p === 'string' && p.includes('acceptance_bucket')) ?? '';
        const m = payloadStr.match(/"acceptance_bucket"\s*:\s*"([^"]+)"/);
        if (m) insertedBuckets.push(m[1]);
        return { rows: [{ id: `task-bk-${insertedBuckets.length}` }] };
      }
      if (/UPDATE acceptance_runs/i.test(sql)) return { rows: [{ ...run, status: 'adjudicated' }] };
    });

    const app = makeApp(makePool(client));
    const res = await request(app)
      .patch('/api/brain/acceptance/runs/test-run-bucket/adjudicate-run')
      .set('Authorization', 'Bearer test-token')
      .send({ by: 'adjudicator-1' });

    expect(res.status).toBe(200);
    // bug 和 trace 两个 bucket 都必须独立建出（查重按 bucket 维度区分，不因 bug 存在就阻断 trace）
    expect(insertedBuckets).toContain('bug');
    expect(insertedBuckets).toContain('trace');
  });
});
