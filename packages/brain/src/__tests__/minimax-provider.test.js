/**
 * minimax-provider.test.js
 *
 * 测试双 Provider 路由（Anthropic 默认）：
 * - T1 (D1): getProviderForTask() 默认返回 'anthropic'
 * - T2 (D2): triggerCeceliaRun 传 provider 给 bridge body
 * - T3 (D3): getProviderForTask 已正确导出
 * - T4 (D4): FIXED_PROVIDER 固定路由覆盖默认
 *
 * DoD 映射：
 * - D1 → 'getProviderForTask returns anthropic by default'
 * - D2 → 'triggerCeceliaRun passes provider to bridge'
 * - D3 → 'getProviderForTask is exported'
 * - D4 → 'FIXED_PROVIDER overrides default'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

// Mock trace
vi.mock('../trace.js', () => ({
  traceStep: vi.fn(() => ({ start: vi.fn(), end: vi.fn() })),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US_VPS: 'us' }
}));

// Mock task-router
vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'us'),
  LOCATION_MAP: {}
}));

// Mock task-updater
vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn()
}));

// ================================================================
// T1 + T3 + T4: getProviderForTask 逻辑测试
// ================================================================

describe('getProviderForTask - 双 Provider 路由', () => {
  let getProviderForTask;
  let FIXED_PROVIDER;

  beforeEach(async () => {
    const executor = await import('../executor.js');
    getProviderForTask = executor.getProviderForTask;
    FIXED_PROVIDER = executor.FIXED_PROVIDER;
  });

  it('T3 (D3): getProviderForTask 已从 executor.js 导出', () => {
    expect(getProviderForTask).toBeDefined();
    expect(typeof getProviderForTask).toBe('function');
  });

  it('T1 (D1): dev 任务返回 anthropic（默认）', () => {
    const task = { id: 'task-1', task_type: 'dev', title: '编码任务' };
    expect(getProviderForTask(task)).toBe('anthropic');
  });

  it('T4 (D4): codex_qa 任务固定返回 openai', () => {
    const task = { id: 'task-3', task_type: 'codex_qa', title: 'Codex QA' };
    expect(getProviderForTask(task)).toBe('openai');
  });

  it('T1 (D1): talk 任务返回 anthropic（默认，无 fixed_provider）', () => {
    const task = { id: 'task-4', task_type: 'talk', title: '对话任务' };
    expect(getProviderForTask(task)).toBe('anthropic');
  });

  it('T1 (D1): undefined task_type 返回 anthropic', () => {
    const task = { id: 'task-5', title: '未知类型' };
    expect(getProviderForTask(task)).toBe('anthropic');
  });

  it('T4 (D4): FIXED_PROVIDER 包含正确映射', () => {
    expect(FIXED_PROVIDER.codex_qa).toBe('openai');
    // decomp_review/talk/research 不再有 fixed_provider，走 default_provider
    expect(FIXED_PROVIDER.decomp_review).toBeUndefined();
    expect(FIXED_PROVIDER.talk).toBeUndefined();
    expect(FIXED_PROVIDER.research).toBeUndefined();
    expect(FIXED_PROVIDER.exploratory).toBeUndefined();
  });
});

// ================================================================
// T2: triggerCeceliaRun 传 provider 给 bridge
// ================================================================

describe('triggerCeceliaRun - provider 传递给 bridge', () => {
  let triggerCeceliaRun;
  let capturedBody;

  beforeEach(async () => {
    capturedBody = null;
    mockQuery.mockReset();

    // Mock updateTaskRunInfo query
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    // Mock global fetch to capture the request body
    global.fetch = vi.fn(async (url, opts) => {
      if (url.includes('/trigger-cecelia')) {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({ ok: true, log_file: '/tmp/test.log' })
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const executor = await import('../executor.js');
    triggerCeceliaRun = executor.triggerCeceliaRun;
  });

  it('T2 (D2): bridge 请求 body 包含 provider=anthropic', async () => {
    const task = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      title: '测试任务',
      task_type: 'dev',
      description: '测试描述',
      payload: {},
    };

    const result = await triggerCeceliaRun(task);

    // 验证 fetch 被调用
    expect(global.fetch).toHaveBeenCalled();

    // 验证 body 包含 provider 字段
    expect(capturedBody).toBeDefined();
    expect(capturedBody.provider).toBe('anthropic');
    expect(capturedBody.task_id).toBe(task.id);
  });
});
