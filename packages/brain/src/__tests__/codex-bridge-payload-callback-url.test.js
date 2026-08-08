/**
 * codex-bridge-payload-callback-url.test.js
 *
 * 回归测试：buildCodexBridgePayload 构造的 POST payload 必须携带 callback_url。
 * 根因：task_type=research 路由到 xian bridge，旧版 payload 缺 callback_url，
 * 导致 bridge 返回 { ok:false, error:"task_id 和 callback_url 必填" }，
 * 累积触发熔断器堵塞全队列 34 分钟（2026-07-14 11:04-11:38）。
 *
 * 修复点：executor.js buildCodexBridgePayload 加入
 *   callback_url: `${process.env.BRAIN_URL || 'http://localhost:5221'}/api/brain/execution-callback`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── 路由 mock：让 research/codex_dev 等落到 xian location ─────────────────
const getTaskLocationMock = vi.fn((taskType) => {
  if (['research', 'codex_dev', 'codex_qa', 'crystallize_forge'].includes(taskType)) return 'xian';
  return 'us';
});
const getInternalTaskHandlerMock = vi.fn(() => null);
vi.mock('../task-router.js', () => ({
  getTaskLocation: (...args) => getTaskLocationMock(...args),
  getInternalTaskHandler: (...args) => getInternalTaskHandlerMock(...args),
  TASK_REQUIREMENTS: {},
}));

// ── task-type-config-cache：无动态覆盖 ──────────────────────────────────
vi.mock('../task-type-config-cache.js', () => ({
  loadCache: vi.fn(),
  refreshCache: vi.fn(),
  getCachedLocation: vi.fn(() => null),
  getCachedConfig: vi.fn(() => null),
}));

// ── trace：不关心 US claude 路径 ─────────────────────────────────────────
vi.mock('../trace.js', () => ({
  traceStep: vi.fn(() => ({ start: vi.fn(async () => {}), end: vi.fn(async () => {}) })),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { FAILED: 'failed', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US_VPS: 'us', HK: 'hk' },
}));

// ── 其余副作用依赖最小化 mock ────────────────────────────────────────────
vi.mock('../decisions-context.js', () => ({ getDecisionsSummary: vi.fn(async () => '') }));
const dbQueryMock = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
vi.mock('../db.js', () => ({ default: { query: dbQueryMock } }));
vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(async () => {}),
  updateTaskProgress: vi.fn(),
}));
vi.mock('../routing/resolve-executor.js', () => ({
  resolveExecutor: vi.fn(),
  ExecutorRouteError: class ExecutorRouteError extends Error {},
  FALLBACK_ROUTE: { machineId: 'us', executor: 'claude', url: 'http://localhost:3457' },
}));
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    unref: vi.fn(),
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  })),
  execSync: vi.fn(() => ''),
  exec: vi.fn(),
}));
vi.mock('fs/promises', () => ({ writeFile: vi.fn(), mkdir: vi.fn(), access: vi.fn() }));

// ── helper：从 fetch mock 取 xian bridge /run 调用的 payload ─────────────
function getRunPayloads(fetchMock) {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/run'))
    .map(([, opts]) => {
      try { return JSON.parse(opts.body); } catch { return null; }
    });
}

describe('buildCodexBridgePayload — callback_url 必填字段', () => {
  let triggerCeceliaRun;
  let fetchMock;
  const origBrainUrl = process.env.BRAIN_URL;

  beforeEach(async () => {
    vi.clearAllMocks();
    getTaskLocationMock.mockImplementation((taskType) => {
      if (['research', 'codex_dev', 'codex_qa', 'crystallize_forge'].includes(taskType)) return 'xian';
      return 'us';
    });
    getInternalTaskHandlerMock.mockReturnValue(null);
  });

  afterEach(() => {
    if (origBrainUrl !== undefined) {
      process.env.BRAIN_URL = origBrainUrl;
    } else {
      delete process.env.BRAIN_URL;
    }
  });

  it('research 任务的 payload 必须包含 callback_url', async () => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, account: 'team1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const executor = await import('../executor.js');
    triggerCeceliaRun = executor.triggerCeceliaRun;

    const task = {
      id: 'research-task-id-0001',
      task_type: 'research',
      title: '调研 research payload',
      description: '验证 callback_url 存在',
      payload: {},
      project_id: null,
    };

    await triggerCeceliaRun(task);

    const payloads = getRunPayloads(fetchMock);
    expect(payloads.length).toBeGreaterThan(0);
    const payload = payloads[0];
    expect(payload).toHaveProperty('callback_url');
    expect(payload.callback_url).toMatch(/\/api\/brain\/execution-callback$/);
  });

  it('bridge 请求携带同一个 run_id，并在发请求前写入 task current_run_id', async () => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, account: 'team1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { triggerCeceliaRun } = await import('../executor.js');
    const result = await triggerCeceliaRun({
      id: 'research-task-run-id-0001',
      task_type: 'research',
      title: '验证运行身份',
      payload: { base_repo: 'perfectuser21/cecelia' },
      project_id: null,
    });

    const payload = getRunPayloads(fetchMock)[0];
    expect(payload.run_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result.runId).toBe(payload.run_id);
    const runInfoWriteIndex = dbQueryMock.mock.calls.findIndex(
      ([sql, params]) => typeof sql === 'string' && sql.includes("'current_run_id'") && params?.[1] === payload.run_id
    );
    expect(runInfoWriteIndex, 'Bridge POST 前必须持久化 current_run_id').toBeGreaterThanOrEqual(0);
    expect(dbQueryMock.mock.invocationCallOrder[runInfoWriteIndex]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it('bridge 请求携带 canonical base_repo，且不发送源机器绝对 work_dir', async () => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, account: 'team1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { triggerCeceliaRun } = await import('../executor.js');
    await triggerCeceliaRun({
      id: 'research-task-workspace-0001',
      task_type: 'research',
      title: '验证跨设备 workspace',
      payload: { base_repo: 'perfectuser21/cecelia' },
      project_id: null,
    });

    const payload = getRunPayloads(fetchMock)[0];
    expect(payload.base_repo).toBe('perfectuser21/cecelia');
    expect(payload).not.toHaveProperty('work_dir');
  });

  it('callback_url 指向 BRAIN_URL env 配置的地址', async () => {
    process.env.BRAIN_URL = 'http://hk-vps:5221';

    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, account: 'team1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const executor = await import('../executor.js');
    triggerCeceliaRun = executor.triggerCeceliaRun;

    const task = {
      id: 'research-task-id-0002',
      task_type: 'research',
      title: '调研 BRAIN_URL',
      payload: {},
      project_id: null,
    };

    await triggerCeceliaRun(task);

    const payloads = getRunPayloads(fetchMock);
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads[0].callback_url).toBe('http://hk-vps:5221/api/brain/execution-callback');
  });

  it('BRAIN_URL 未设置时 callback_url 降级到 localhost:5221', async () => {
    delete process.env.BRAIN_URL;

    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, account: 'team1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const executor = await import('../executor.js');
    triggerCeceliaRun = executor.triggerCeceliaRun;

    const task = {
      id: 'research-task-id-0003',
      task_type: 'research',
      title: '调研 localhost 降级',
      payload: {},
      project_id: null,
    };

    await triggerCeceliaRun(task);

    const payloads = getRunPayloads(fetchMock);
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads[0].callback_url).toBe('http://localhost:5221/api/brain/execution-callback');
  });

  it('codex_dev 等其他 xian task_type 同样携带 callback_url', async () => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, account: 'team1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const executor = await import('../executor.js');
    triggerCeceliaRun = executor.triggerCeceliaRun;

    for (const taskType of ['codex_dev', 'codex_qa']) {
      fetchMock.mockClear();
      const task = {
        id: `${taskType}-task-id-0001`,
        task_type: taskType,
        title: `测试 ${taskType}`,
        payload: {},
        project_id: null,
      };

      await triggerCeceliaRun(task);

      const payloads = getRunPayloads(fetchMock);
      expect(payloads.length, `${taskType} 应有 /run 调用`).toBeGreaterThan(0);
      expect(payloads[0].callback_url, `${taskType} payload 必须含 callback_url`).toMatch(
        /\/api\/brain\/execution-callback$/
      );
    }
  });
});

describe('triggerCodexBridge — research 任务 — bridge 拒绝缺 callback_url 路径', () => {
  let triggerCeceliaRun;

  beforeEach(async () => {
    vi.clearAllMocks();
    getTaskLocationMock.mockImplementation((taskType) => {
      if (['research', 'codex_dev', 'codex_qa'].includes(taskType)) return 'xian';
      return 'us';
    });
    getInternalTaskHandlerMock.mockReturnValue(null);
  });

  it('bridge 拒绝缺字段时返回 success=false（task_id 和 callback_url 必填）', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, error: 'task_id 和 callback_url 必填' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const executor = await import('../executor.js');
    triggerCeceliaRun = executor.triggerCeceliaRun;

    const task = {
      id: 'research-fail-task-001',
      task_type: 'research',
      title: '触发 bridge 拒绝',
      payload: {},
      project_id: null,
    };

    const result = await triggerCeceliaRun(task);

    expect(result.success).toBe(false);
    expect(result.error).toBe('task_id 和 callback_url 必填');
  });
});
