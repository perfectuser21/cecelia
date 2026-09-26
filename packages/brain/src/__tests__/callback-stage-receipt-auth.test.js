/**
 * [BEHAVIOR] 棒1 回执线（链 bf5088a3，任务 15346e6c，决策 702949b6/280bd091）：
 *  - 终态回执 result 里的 stage / stage_status / metrics / evidence / probes 经 finishRun 合进 task_runs.result
 *    （evidence/probes 只留引用形态，不落大 blob）；artifacts / pr_url 逻辑原样保留
 *  - execution-callback 挂 internalAuthOrLoopback：CECELIA_INTERNAL_TOKEN 配置后缺头 401，带 Bearer 放行
 *  - 内部调用方（cecelia-run.sh / flush-callback-queue.sh / executor / bridge）接线：Bearer 头 / 容器 env 透传
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finishRun, recordRunFromCallback } from '../lib/task-run.js';

const BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(BRAIN_ROOT, rel), 'utf8');

function fakePool() {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (/INSERT INTO task_runs/i.test(sql)) return { rows: [{ id: 'row-1', run_id: 'r' }] };
      if (/UPDATE task_runs/i.test(sql)) return { rows: [{ id: 'row-1' }] };
      return { rows: [] };
    }),
  };
}
const updateResult = (pool) => JSON.parse(pool.calls.find((c) => /UPDATE task_runs/i.test(c.sql)).params[2]);

describe('recordRunFromCallback — 终态回执保 stage/metrics', () => {
  it('result 里的 stage / stage_status / metrics 合进 task_runs.result，artifacts + pr_url 原样保留', async () => {
    const pool = fakePool();
    await recordRunFromCallback(
      {
        taskId: 't1', runId: 'r1', status: 'completed', exitCode: 0,
        result: { stage: 'publish', stage_status: 'ok', metrics: { posts: 3, duration_ms: 1200 }, artifacts: ['a:1'], summary: 'x' },
        prUrl: 'https://github.com/o/r/pull/9',
      },
      { pool },
    );
    const res = updateResult(pool);
    expect(res).toMatchObject({
      exit_code: 0,
      artifacts: ['a:1', 'https://github.com/o/r/pull/9'],
      stage: 'publish',
      stage_status: 'ok',
      metrics: { posts: 3, duration_ms: 1200 },
    });
    expect(res).not.toHaveProperty('summary');
  });

  it('evidence / probes 只留引用形态（字符串 / {ref|url|path|name|key|observed|probed_at|error}），大 blob 不落', async () => {
    const pool = fakePool();
    await recordRunFromCallback(
      {
        taskId: 't1', runId: 'r1', status: 'completed',
        result: {
          stage: 'sort',
          evidence: [
            '/var/log/x.json',
            { path: '/tmp/a.png', name: 'shot', blob: 'x'.repeat(5000) },
            { url: 'https://e/1', raw: { huge: true } },
            42,
          ],
          probes: [{ key: 'adb', observed: 'online', probed_at: '2026-09-26T00:00:00Z', dump: 'y'.repeat(3000) }],
        },
      },
      { pool },
    );
    const res = updateResult(pool);
    expect(res.evidence).toEqual([
      '/var/log/x.json',
      { path: '/tmp/a.png', name: 'shot' },
      { url: 'https://e/1' },
    ]);
    expect(res.probes).toEqual([{ key: 'adb', observed: 'online', probed_at: '2026-09-26T00:00:00Z' }]);
    expect(JSON.stringify(res)).not.toMatch(/xxxxx|yyyyy/);
  });

  it('result 无这些键时不添无谓字段；非终态回执仍只 startRun', async () => {
    const plain = fakePool();
    await recordRunFromCallback({ taskId: 't', runId: 'r', status: 'completed', exitCode: 0, result: { summary: 's' } }, { pool: plain });
    expect(updateResult(plain)).toEqual({ exit_code: 0, artifacts: [] });

    const running = fakePool();
    await recordRunFromCallback({ taskId: 't', runId: 'r', status: 'in_progress', result: { stage: 'x' } }, { pool: running });
    expect(running.calls.some((c) => /UPDATE task_runs/i.test(c.sql))).toBe(false);
  });

  it('finishRun 接 result 入参并与 exit_code/artifacts 合并（exit_code/artifacts 不被覆盖）', async () => {
    const pool = fakePool();
    await finishRun({ runId: 'r', status: 'completed', exitCode: 0, artifacts: ['a'], result: { stage: 's', exit_code: 99, artifacts: ['bad'] } }, { pool });
    expect(updateResult(pool)).toEqual({ exit_code: 0, artifacts: ['a'], stage: 's' });
  });
});

describe('execution-callback 路由鉴权（internalAuthOrLoopback）', () => {
  const src = read('src/routes/execution.js');

  it('路由挂 internalAuthOrLoopback 中间件', () => {
    expect(src).toMatch(/import \{[^}]*internalAuthOrLoopback[^}]*\} from '\.\.\/middleware\/internal-auth\.js'/);
    expect(src).toMatch(/router\.post\('\/execution-callback',\s*internalAuthOrLoopback,/);
  });
});

describe('内部调用方接线（Bearer 头只从 env CECELIA_INTERNAL_TOKEN 读）', () => {
  it('cecelia-run.sh / flush-callback-queue.sh 回执 curl 带 Authorization: Bearer', () => {
    const run = read('scripts/cecelia-run.sh');
    const flush = read('scripts/flush-callback-queue.sh');
    for (const sh of [run, flush]) {
      expect(sh).toMatch(/Authorization: Bearer \$\{?CECELIA_INTERNAL_TOKEN\}?/);
    }
    // 只从 env 读：脚本不得出现字面 token 赋值
    expect(run).not.toMatch(/CECELIA_INTERNAL_TOKEN=["'][^"'$]/);
  });

  it('executor.js：docker 容器 env 透传 token；codex review fetch / 本地 codex curl 带 Bearer', () => {
    const ex = read('src/executor.js');
    expect(ex).toMatch(/import \{[^}]*internalServiceHeaders[^}]*\} from '\.\/lib\/internal-service-auth\.js'/);
    const dockerEnvIdx = ex.indexOf('const dockerEnv = {');
    expect(dockerEnvIdx).toBeGreaterThan(0);
    expect(ex.slice(dockerEnvIdx, dockerEnvIdx + 1200)).toContain('CECELIA_INTERNAL_TOKEN');
    // 两处 codex review fetch 用 internalServiceHeaders 包头
    const fetches = ex.split('/api/brain/execution-callback`, {').length - 1;
    expect(fetches).toBe(2);
    expect(ex.match(/execution-callback`, \{\s*method: 'POST',\s*headers: internalServiceHeaders\(/g)?.length ?? 0).toBe(2);
    // 本地 codex 脚本 curl
    expect(ex).toMatch(/curl -s -X POST "\$\{WEBHOOK_URL\}"[^\n]*Authorization: Bearer/);
  });

  it('cecelia-bridge.js 把宿主 CECELIA_INTERNAL_TOKEN 透传给 cecelia-run', () => {
    const bridge = read('scripts/cecelia-bridge.js');
    expect(bridge).toMatch(/CECELIA_INTERNAL_TOKEN/);
  });
});

describe('execution-callback supertest：token 配置后缺头 401 / Bearer 200', () => {
  const TOKEN = 'baton1-test-token';
  let app;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CECELIA_INTERNAL_TOKEN = TOKEN;
    mockPool = {
      query: vi.fn(async (sql) => {
        // 幂等短路：让路由在鉴权之后、事务之前返回 200（只验闸门，不验业务）
        if (typeof sql === 'string' && sql.includes("trigger = 'execution-callback'") && sql.includes('SELECT id FROM decision_log')) {
          return { rows: [{ id: 'dup' }] };
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO callback_queue')) return { rows: [{ id: 'cq-1' }] };
        return { rows: [] };
      }),
      connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
    };
    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../executor.js', () => ({
      triggerCeceliaRun: vi.fn(), removeActiveProcess: vi.fn(), getActiveProcesses: vi.fn(() => []),
      getActiveProcessCount: vi.fn(() => 0), checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
      probeTaskLiveness: vi.fn(async () => []), recordHeartbeat: vi.fn(async () => ({ success: true })),
    }));
    vi.doMock('../tick.js', () => ({ runTickSafe: vi.fn(async () => ({})), getTickStatus: vi.fn(() => ({})) }));
    vi.doMock('../thalamus.js', () => ({ processEvent: vi.fn(async () => ({})), EVENT_TYPES: {} }));
    vi.doMock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn(async () => {}) }));
    vi.doMock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
    vi.doMock('../embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn() }));
    const express = (await import('express')).default;
    const { default: router } = await import('../routes/execution.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  afterEach(() => {
    delete process.env.CECELIA_INTERNAL_TOKEN;
    vi.doUnmock('../db.js');
  });

  it('缺头 → 401 UNAUTHORIZED，且不碰库', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/brain/execution-callback').send({ task_id: 't', run_id: 'r', status: 'completed' });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHORIZED');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('错 token → 401', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/brain/execution-callback')
      .set('Authorization', 'Bearer nope').send({ task_id: 't', run_id: 'r', status: 'completed' });
    expect(res.status).toBe(401);
  });

  it('带 Bearer → 200 进入处理', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/brain/execution-callback')
      .set('Authorization', `Bearer ${TOKEN}`).send({ task_id: 't', run_id: 'r', status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
