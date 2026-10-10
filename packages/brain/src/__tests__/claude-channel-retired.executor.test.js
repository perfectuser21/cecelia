vi.mock('../spawn/index.js', () => ({ spawn: vi.fn(async () => ({ exit_code: 0, started_at: 'now', container: 'fake' })) }));
vi.mock('../execution-directory/legacy-executor.js', async original => ({ ...await original(), withLegacyExecution: async (_input, operation) => operation() }));
vi.mock('../runtime-safety.js', () => ({ assertExternalExecutionAllowed: () => {} }));
/**
 * Claude 无头通道下线 —— executor 的 claude 桥接派发（任务 76a160b3）
 *
 * - checkCeceliaRunAvailable(task)：任务落在 claude 桥接路径 → {available:false, error:'claude_channel_retired'}，
 *   不探活 bridge；codex 等其它路径照旧探活
 * - triggerCeceliaRun：claude 桥接 / Docker claude / 显式 executor=claude 一律不 fetch /trigger-cecelia、
 *   不起容器，返回 reason=claude_channel_retired
 * - codex override 不受影响
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resolveExecutorMock = vi.fn();
vi.mock('../routing/resolve-executor.js', () => ({
  resolveExecutor: (...args) => resolveExecutorMock(...args),
  ExecutorRouteError: class ExecutorRouteError extends Error {},
  FALLBACK_ROUTE: { machineId: 'mac-mini-m4-us', executor: 'claude', url: 'http://localhost:3457' },
}));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn(async () => {}), updateTaskProgress: vi.fn() }));
const getTaskLocationMock = vi.fn(() => 'us');
vi.mock('../task-router.js', () => ({
  getTaskLocation: (...args) => getTaskLocationMock(...args),
  getInternalTaskHandler: vi.fn(() => null),
  TASK_REQUIREMENTS: {},
}));
const getCachedConfigMock = vi.fn(() => null);
vi.mock('../task-type-config-cache.js', () => ({
  loadCache: vi.fn(), refreshCache: vi.fn(),
  getCachedLocation: vi.fn(() => null),
  getCachedConfig: (...args) => getCachedConfigMock(...args),
}));
const traceStepMock = vi.fn(() => ({ start: vi.fn(async () => {}), end: vi.fn(async () => {}) }));
vi.mock('../trace.js', () => ({
  traceStep: (...args) => traceStepMock(...args),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { FAILED: 'failed', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US_VPS: 'us', HK: 'hk' },
}));
vi.mock('../decisions-context.js', () => ({ getDecisionsSummary: vi.fn(async () => '') }));
vi.mock('../db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), pid: 12345, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } })),
  execSync: vi.fn(() => ''),
  exec: vi.fn(),
}));
vi.mock('fs/promises', () => ({ writeFile: vi.fn(), mkdir: vi.fn(), access: vi.fn() }));

const CLAUDE_BOUND = { id: 'aaaaaaaa-1111-4222-8333-444444444444', task_type: 'talk', title: 't', payload: {} };

describe('executor：claude 桥接派发下线', () => {
  let executor;
  let fetchMock;
  beforeEach(async () => {
    vi.clearAllMocks();
    getTaskLocationMock.mockReturnValue('us');
    getCachedConfigMock.mockReturnValue(null);
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, status: 'healthy', accounts: [{ primaryUsedPct: 10, tokenExpired: false }], account: 'team3' }) }));
    vi.stubGlobal('fetch', fetchMock);
    executor = await import('../executor.js');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const bridgeCalls = () => fetchMock.mock.calls.filter(([url]) => /trigger-cecelia|:3457/.test(String(url)));

  it('checkCeceliaRunAvailable(claude 桥接任务) → 不可用 claude_channel_retired，不探活 bridge', async () => {
    const r = await executor.checkCeceliaRunAvailable(CLAUDE_BOUND);
    expect(r).toMatchObject({ available: false, error: 'claude_channel_retired' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checkCeceliaRunAvailable(显式 executor=claude) → 不可用 claude_channel_retired', async () => {
    const r = await executor.checkCeceliaRunAvailable({ ...CLAUDE_BOUND, task_type: 'codex_dev', payload: { executor: 'claude' } });
    expect(r).toMatchObject({ available: false, error: 'claude_channel_retired' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['西安 codex（location=xian）', { location: 'xian' }, { task_type: 'codex_dev' }],
    ['显式 executor=codex', {}, { payload: { executor: 'codex', machine: 'xian-m4' } }],
    ['动态 executor=codex', { dynamic: 'codex' }, {}],
  ])('checkCeceliaRunAvailable(%s) 不受影响：照旧探活', async (_label, env, patch) => {
    if (env.location) getTaskLocationMock.mockReturnValue(env.location);
    if (env.dynamic) getCachedConfigMock.mockReturnValue({ executor: env.dynamic });
    const r = await executor.checkCeceliaRunAvailable({ ...CLAUDE_BOUND, ...patch });
    expect(r.available).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/health$/), expect.any(Object));
  });

  it('triggerCeceliaRun(claude 桥接任务) → 不 fetch /trigger-cecelia，返回 claude_channel_retired', async () => {
    const r = await executor.triggerCeceliaRun(CLAUDE_BOUND);
    expect(r).toMatchObject({ success: false, reason: 'claude_channel_retired' });
    expect(bridgeCalls()).toHaveLength(0);
    expect(traceStepMock).not.toHaveBeenCalled();
  });

  it('HARNESS_DOCKER_ENABLED=true 也不起 claude 容器', async () => {
    vi.stubEnv('HARNESS_DOCKER_ENABLED', 'true');
    const r = await executor.triggerCeceliaRun(CLAUDE_BOUND);
    expect(r).toMatchObject({ success: false, reason: 'claude_channel_retired' });
    expect((await import('../spawn/index.js')).spawn).not.toHaveBeenCalled();
  });

  it('显式路由解析到 claude → claude_channel_retired，不派发', async () => {
    resolveExecutorMock.mockResolvedValue({ machineId: 'mac-mini-m4-us', executor: 'claude', url: 'http://localhost:3457' });
    const r = await executor.triggerCeceliaRun({ ...CLAUDE_BOUND, task_type: 'dev', payload: { machine: 'mac-mini-m4-us', executor: 'claude' } });
    expect(r).toMatchObject({ success: false, reason: 'claude_channel_retired' });
    expect(bridgeCalls()).toHaveLength(0);
  });

  it('显式路由解析到 codex → 仍走 codex bridge（不受影响）', async () => {
    resolveExecutorMock.mockResolvedValue({ machineId: 'xian-m4', executor: 'codex', url: 'http://100.86.57.69:13458' });
    const r = await executor.triggerCeceliaRun({ ...CLAUDE_BOUND, task_type: 'codex_dev', payload: { machine: 'xian-m4', executor: 'codex' } });
    expect(r.executor).toBe('codex-bridge');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === 'http://100.86.57.69:13458/run')).toBe(true);
  });
});
