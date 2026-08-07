import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAcceptancePublicRouter, submitAcceptanceResults } from '../acceptance.js';

function makeApp(pool) {
  const app = express();
  app.use(express.json());
  app.use(createAcceptancePublicRouter({ pool }));
  return app;
}

// 本文件的 check_key 沿用旧 {run_key}:{NNN} 流水号格式：提交路径刻意不校验格号，
// 存量 21 行历史数据必须还能回写（migration 392 注释「不回填/不改写」）。
function makeClient(scripts) {
  const query = vi.fn(async (sql, params) => {
    // run 作用域寻址：所有用例都提交给同一个 run，逐个脚本重复声明没有意义。
    // detail: null = 这批 run 不带版本戳，冻结锁（J12-A）对它们不适用。
    if (/^SELECT id.*FROM acceptance_runs WHERE run_key/.test(sql)) {
      return { rows: [{ id: 'A', status: 'pending', detail: null }] };
    }
    return scripts(sql, params) ?? { rows: [] };
  });
  return { query, release: vi.fn() };
}

describe('GET /acceptance/pending', () => {
  it('返回 pending/in_review 的 runs 各带 checks', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('FROM acceptance_runs')) {
          return { rows: [{ id: 'A', run_key: 'r1', status: 'pending' }] };
        }
        if (sql.includes('FROM acceptance_checks')) {
          return { rows: [{ run_id: 'A', check_key: 'r1:001', result: null }] };
        }
        return { rows: [] };
      }),
      connect: vi.fn(),
    };
    const res = await request(makeApp(pool)).get('/acceptance/pending');
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].checks).toHaveLength(1);
  });

  it('查询抛错 → 500 且不泄漏内部信息', async () => {
    const pool = {
      query: vi.fn(async () => { throw new Error('relation "acceptance_runs" does not exist'); }),
      connect: vi.fn(),
    };
    const res = await request(makeApp(pool)).get('/acceptance/pending');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
  });
});

describe('POST /acceptance/results', () => {
  it('result 枚举非法 → 400 整批拒绝', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ run_key: 'r1', results: [{ check_key: 'r1:001', result: 'yes' }] });
    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('未知 check_key → 400 列出 missing，事务回滚', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT check_key FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ run_key: 'r1', results: [
        { check_key: 'r1:001', result: '通过' },
        { check_key: 'r1:999', result: '通过' },
      ] });
    expect(res.status).toBe(400);
    expect(res.body.missing).toEqual(['r1:999']);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('合法批次：落库 + 重算 pass_rate/status（人列填满含不通过 → human_complete）', async () => {
    const updates = [];
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }, { check_key: 'r1:002', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) { updates.push(params); return { rows: [] }; }
      if (sql.includes('FILTER')) {
        return { rows: [{ total: 2, pass: 1, fail: 1, pending: 0 }] };
      }
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ run_key: 'r1', results: [
        { check_key: 'r1:001', result: '通过' },
        { check_key: 'r1:002', result: '不通过', note: 'step8 挂了' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    // migration 392 起 status 只反映人列填写进度：填满即 human_complete，
    // 「这一轮通过没通过」由 gate_verdict 单独表达（旧断言写 failed）
    expect(res.body.runs[0].status).toBe('human_complete');
    expect(res.body.runs[0].pass_rate).toBe(0.5);
    expect(updates).toHaveLength(2);
  });

  it('还有未判项 → status=in_review', async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) return { rows: [] };
      if (sql.includes('FILTER')) return { rows: [{ total: 3, pass: 1, fail: 0, pending: 2 }] };
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ run_key: 'r1', results: [{ check_key: 'r1:001', result: '通过' }] });
    expect(res.status).toBe(200);
    expect(res.body.runs[0].status).toBe('in_review');
  });

  // 「无法验证」也是一次填写，人列因此算填满 → human_complete。
  // 旧语义让它把 run 卡在 in_review，等于用 status 兼职表达「这格没结论」；
  // 392 之后这件事归格级 final_state 和 run 级 gate_verdict 管，status 不掺和。
  it('全部已判但含"无法验证" → 人列仍算填满 → human_complete', async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:003', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) return { rows: [] };
      if (sql.includes('FILTER')) return { rows: [{ total: 3, pass: 2, fail: 0, pending: 0 }] };
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ run_key: 'r1', results: [{ check_key: 'r1:003', result: '无法验证' }] });
    expect(res.status).toBe(200);
    expect(res.body.runs[0].status).toBe('human_complete');
  });

  it('同批出现重复 check_key → 400，且不占用连接', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ run_key: 'r1', results: [
        { check_key: 'r1:001', result: '通过' },
        { check_key: 'r1:001', result: '不通过' },
      ] });
    expect(res.status).toBe(400);
    expect(res.body.check_key).toBe('r1:001');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('results 空/非数组 → 400', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const res = await request(makeApp(pool)).post('/acceptance/results').send({ run_key: 'r1', results: [] });
    expect(res.status).toBe(400);
  });
});

describe('验收驳回自动开任务（主理人条件二：转变沿）', () => {
  function rejectionClient({ oldStatus, existingTask = false }) {
    const taskInserts = [];
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) return { rows: [] };
      if (sql.includes('SELECT status, title, gp_id, run_key FROM acceptance_runs')) {
        return { rows: [{ status: oldStatus, title: 'T', gp_id: 'gp1', run_key: 'r1' }] };
      }
      if (sql.includes('FILTER')) return { rows: [{ total: 1, pass: 0, fail: 1, pending: 0 }] };
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
      if (sql.includes("FROM tasks")) return { rows: existingTask ? [{ ok: 1 }] : [] };
      if (sql.includes("result = '不通过'") && sql.includes('SELECT check_key, name')) {
        return { rows: [{ check_key: 'r1:001', name: 'step8', note: '挂了' }] };
      }
      if (sql.includes('INSERT INTO tasks')) { taskInserts.push(params); return { rows: [] }; }
    });
    return { client, taskInserts };
  }

  async function postFail(client) {
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    return request(makeApp(pool)).post('/acceptance/results')
      .send({ run_key: 'r1', results: [{ check_key: 'r1:001', result: '不通过' }] });
  }

  // migration 392 起 computeRunStatus 永不产生 failed，isLegacyRejectionTransition 恒不成立，
  // 「判不通过就自动开驳回任务」这条转变沿对新 run 已不可达（只剩存量 failed 行走它）。
  // 分流建任务由 D4 的聚合式分流接管，届时 routes/acceptance.js 里整段删除。
  it('判不通过不再走转变沿自动开驳回任务（D4 聚合式分流接管前的空窗）', async () => {
    const { client, taskInserts } = rejectionClient({ oldStatus: 'in_review' });
    const res = await postFail(client);
    expect(res.status).toBe(200);
    expect(taskInserts).toHaveLength(0);
  });

  it('已是 failed（重复提交）→ 不重复开任务', async () => {
    const { client, taskInserts } = rejectionClient({ oldStatus: 'failed' });
    const res = await postFail(client);
    expect(res.status).toBe(200);
    expect(taskInserts).toHaveLength(0);
  });

  it('转变沿但已有未终态驳回任务 → 查重跳过', async () => {
    const { client, taskInserts } = rejectionClient({ oldStatus: 'in_review', existingTask: true });
    const res = await postFail(client);
    expect(res.status).toBe(200);
    expect(taskInserts).toHaveLength(0);
  });
});

describe('GET /acceptance/catalog（Worker 拉目录）', () => {
  it('已种 → 200 带 catalog+updated_at', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('FROM acceptance_catalog')) {
          return { rows: [{ payload: { golden_paths: [{ id: 'g1' }] }, updated_at: '2026-07-30T00:00:00Z' }] };
        }
        return { rows: [] };
      }),
      connect: vi.fn(),
    };
    const res = await request(makeApp(pool)).get('/acceptance/catalog');
    expect(res.status).toBe(200);
    expect(res.body.catalog.golden_paths).toHaveLength(1);
    expect(res.body.updated_at).toBeTruthy();
  });

  it('未种 → 404', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() };
    const res = await request(makeApp(pool)).get('/acceptance/catalog');
    expect(res.status).toBe(404);
  });
});

describe('submitAcceptanceResults 驳回任务并发去重', () => {
  it('INSERT tasks 撞 23505 时静默忽略，整体仍返回成功', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (/^SELECT id.*FROM acceptance_runs WHERE run_key/.test(sql)) {
          return { rows: [{ id: 'run-1', status: 'pending', detail: null }] };
        }
        if (sql.includes('SELECT check_key FROM acceptance_checks')) {
          return { rows: [{ check_key: 'r1:001', run_id: 'run-1' }] };
        }
        if (sql.includes('UPDATE acceptance_checks SET result')) return { rows: [] };
        if (sql.includes('SELECT COUNT(*)::int AS total')) {
          return { rows: [{ total: 1, pass: 0, fail: 1, pending: 0 }] };
        }
        if (sql.includes('SELECT status, title, gp_id, run_key FROM acceptance_runs')) {
          return { rows: [{ status: 'pending', title: 'T', gp_id: 'gp1', run_key: 'r1' }] };
        }
        if (sql.includes('UPDATE acceptance_runs SET pass_rate')) {
          return { rows: [{ run_key: 'r1', pass_rate: 0, status: 'failed' }] };
        }
        if (sql.includes("SELECT 1 FROM tasks")) return { rows: [] };
        if (sql.includes('SELECT check_key, name, note FROM acceptance_checks')) return { rows: [] };
        if (sql.includes('INSERT INTO tasks')) {
          const err = new Error('duplicate key');
          err.code = '23505';
          throw err;
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const result = await submitAcceptanceResults(pool, [{ check_key: 'r1:001', result: '不通过' }], { run_key: 'r1' });
    expect(result.updated).toBe(1);
    expect(result.runs[0].status).toBe('failed');
  });

  it('submitted_by 会被透传进 UPDATE acceptance_checks 参数', async () => {
    const updateCalls = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        if (/^SELECT id.*FROM acceptance_runs WHERE run_key/.test(sql)) {
          return { rows: [{ id: 'run-1', status: 'pending', detail: null }] };
        }
        if (sql.includes('SELECT check_key FROM acceptance_checks')) {
          return { rows: [{ check_key: 'r1:001', run_id: 'run-1' }] };
        }
        if (sql.includes('UPDATE acceptance_checks SET result')) {
          updateCalls.push(params);
          return { rows: [] };
        }
        if (sql.includes('SELECT COUNT(*)::int AS total')) {
          return { rows: [{ total: 1, pass: 1, fail: 0, pending: 0 }] };
        }
        if (sql.includes('SELECT status, title, gp_id, run_key FROM acceptance_runs')) {
          return { rows: [{ status: 'pending', title: 'T', gp_id: 'gp1', run_key: 'r1' }] };
        }
        if (sql.includes('UPDATE acceptance_runs SET pass_rate')) {
          return { rows: [{ run_key: 'r1', pass_rate: 1, status: 'passed' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    await submitAcceptanceResults(pool, [
      { check_key: 'r1:001', result: '通过', note: 'ok', submitted_by: 'alice@zenjoymedia.media' },
    ], { run_key: 'r1' });
    expect(updateCalls).toHaveLength(1);
    // run_id 挤在 check_key 前面：UPDATE 现在按 (run_id, check_key) 定位，不再按全局格号
    expect(updateCalls[0]).toEqual(['通过', 'ok', 'alice@zenjoymedia.media', 'run-1', 'r1:001']);
  });
});
