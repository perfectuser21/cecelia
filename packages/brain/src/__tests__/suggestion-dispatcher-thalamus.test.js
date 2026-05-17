/**
 * suggestion-dispatcher-thalamus.test.js
 *
 * 验证 suggestion-dispatcher 通过丘脑（Thalamus）创建任务，
 * 不再直接 INSERT INTO tasks。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ────────────────────────────────────────────────────────────
// 静态代码检查：确保 suggestion-dispatcher 不含直接 INSERT INTO tasks
// ────────────────────────────────────────────────────────────
describe('suggestion-dispatcher 静态代码约束', () => {
  const srcPath = resolve(__dirname, '../suggestion-dispatcher.js');
  const src = readFileSync(srcPath, 'utf8');

  it('不包含直接 INSERT INTO tasks', () => {
    expect(src).not.toContain('INSERT INTO tasks');
  });

  it('调用 thalamusProcessEvent', () => {
    expect(src).toContain('thalamusProcessEvent');
  });

  it('使用 EVENT_TYPES.SUGGESTION_READY', () => {
    expect(src).toContain('SUGGESTION_READY');
  });
});

// ────────────────────────────────────────────────────────────
// thalamus.js SUGGESTION_READY 事件类型存在
// ────────────────────────────────────────────────────────────
describe('thalamus SUGGESTION_READY 事件定义', () => {
  const thalamSrc = readFileSync(
    resolve(__dirname, '../thalamus.js'),
    'utf8'
  );

  it('EVENT_TYPES 包含 SUGGESTION_READY', () => {
    expect(thalamSrc).toContain("SUGGESTION_READY: 'suggestion_ready'");
  });

  it('quickRoute 中有 SUGGESTION_READY 处理逻辑', () => {
    expect(thalamSrc).toContain('EVENT_TYPES.SUGGESTION_READY');
  });
});

// ────────────────────────────────────────────────────────────
// 单元测试：dispatchPendingSuggestions 调用 thalamus 而非直接 INSERT
// ────────────────────────────────────────────────────────────
describe('dispatchPendingSuggestions — 走丘脑路径', () => {
  let mockPool;
  let thalamusProcessEventMock;
  let createTaskMock;

  beforeEach(async () => {
    vi.resetModules();

    // Mock db.js
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
    };
    vi.doMock('../db.js', () => ({ default: mockPool }));

    // Mock domain-detector.js
    vi.doMock('../domain-detector.js', () => ({
      detectDomain: vi.fn().mockReturnValue({ domain: 'coding', owner_role: 'dev', confidence: 0.8 }),
    }));

    // Mock thalamus: processEvent 返回 create_task 决策
    thalamusProcessEventMock = vi.fn().mockResolvedValue({
      level: 0,
      actions: [
        {
          type: 'create_task',
          params: {
            title: '[SUGGESTION_PLAN] 层级识别：测试内容',
            task_type: 'suggestion_plan',
            priority: 'P2',
            trigger_source: 'suggestion_dispatcher',
            payload: { suggestion_id: '1', suggestion_score: 0.9 },
          }
        },
        { type: 'log_event', params: { event_type: 'suggestion_ready' } }
      ],
      rationale: 'test',
      confidence: 0.9,
    });

    vi.doMock('../thalamus.js', () => ({
      processEvent: thalamusProcessEventMock,
      EVENT_TYPES: { SUGGESTION_READY: 'suggestion_ready' },
    }));

    // Mock actions.js: createTask 返回成功
    createTaskMock = vi.fn().mockResolvedValue({
      success: true,
      task: { id: 'task-uuid-123' },
      deduplicated: false,
    });
    vi.doMock('../actions.js', () => ({ createTask: createTaskMock }));
  });

  it('查到高分 suggestion 时调用 thalamusProcessEvent', async () => {
    // candidates 查询返回一条 suggestion
    mockPool.query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1, content: '测试内容', priority_score: 0.9, source: 'rumination', agent_id: null }] }) // candidates
      .mockResolvedValueOnce({ rows: [] }) // in-flight check
      .mockResolvedValueOnce({ rows: [] }); // UPDATE suggestions

    const { dispatchPendingSuggestions } = await import('../suggestion-dispatcher.js');
    const count = await dispatchPendingSuggestions(mockPool);

    expect(thalamusProcessEventMock).toHaveBeenCalledOnce();
    expect(thalamusProcessEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'suggestion_ready',
        suggestion_id: '1',
        priority_score: 0.9,
      })
    );
    expect(createTaskMock).toHaveBeenCalledOnce();
    expect(count).toBe(1);
  });

  it('thalamus 返回 null 时跳过，不创建任务', async () => {
    thalamusProcessEventMock.mockResolvedValue(null);

    mockPool.query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 2, content: '跳过内容', priority_score: 0.85, source: 'desire', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const { dispatchPendingSuggestions } = await import('../suggestion-dispatcher.js');
    const count = await dispatchPendingSuggestions(mockPool);

    expect(createTaskMock).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});
