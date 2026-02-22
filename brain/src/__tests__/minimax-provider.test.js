/**
 * minimax-provider.test.js
 *
 * 测试 MiniMax provider 支持：
 * - T1 (D1): getProviderForTask() 默认返回 'minimax'
 * - T2 (D2): triggerCeceliaRun 传 provider 给 bridge body
 * - T3 (D3): getProviderForTask 已正确导出
 *
 * DoD 映射：
 * - D1 → 'getProviderForTask returns minimax by default'
 * - D2 → 'triggerCeceliaRun passes provider to bridge'
 * - D3 → 'getProviderForTask is exported'
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
// T1 + T3: getProviderForTask 逻辑测试
// ================================================================

describe('getProviderForTask - MiniMax provider 选择', () => {
  let getProviderForTask;

  beforeEach(async () => {
    const executor = await import('../executor.js');
    getProviderForTask = executor.getProviderForTask;
  });

  it('T3 (D3): getProviderForTask 已从 executor.js 导出', () => {
    expect(getProviderForTask).toBeDefined();
    expect(typeof getProviderForTask).toBe('function');
  });

  it('T1 (D1): dev 任务返回 minimax', () => {
    const task = { id: 'task-1', task_type: 'dev', title: '编码任务' };
    expect(getProviderForTask(task)).toBe('minimax');
  });

  it('T1 (D1): exploratory 任务返回 minimax', () => {
    const task = { id: 'task-2', task_type: 'exploratory', title: '调研任务' };
    expect(getProviderForTask(task)).toBe('minimax');
  });

  it('T1 (D1): talk 任务返回 minimax', () => {
    const task = { id: 'task-3', task_type: 'talk', title: '对话任务' };
    expect(getProviderForTask(task)).toBe('minimax');
  });

  it('T1 (D1): undefined task_type 返回 minimax', () => {
    const task = { id: 'task-4', title: '未知类型' };
    expect(getProviderForTask(task)).toBe('minimax');
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

  it('T2 (D2): bridge 请求 body 包含 provider=minimax', async () => {
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
    expect(capturedBody.provider).toBe('minimax');
    expect(capturedBody.task_id).toBe(task.id);
  });
});
