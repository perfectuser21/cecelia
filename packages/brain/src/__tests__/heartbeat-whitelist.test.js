/**
 * Heartbeat 白名单硬约束测试
 * 覆盖：D5
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(),
}));

const { enforceWhitelist, HEARTBEAT_ALLOWED_ACTIONS } = await import('../heartbeat-inspector.js');

describe('Heartbeat 白名单硬约束', () => {
  it('白名单包含 6 个允许的 action', () => {
    expect(HEARTBEAT_ALLOWED_ACTIONS).toEqual([
      'no_action',
      'log_event',
      'propose_priority_change',
      'propose_weekly_plan',
      'heartbeat_finding',
      'request_human_review',
    ]);
  });

  it('白名单内的 action 不变', () => {
    const actions = [
      { type: 'no_action' },
      { type: 'heartbeat_finding', params: { msg: 'test' } },
      { type: 'propose_weekly_plan', params: {} },
    ];
    const result = enforceWhitelist(actions);
    expect(result).toEqual(actions);
  });

  it('非白名单 action 被转换为 heartbeat_finding', () => {
    const actions = [
      { type: 'dispatch_task', params: { task_id: '123' } },
    ];
    const result = enforceWhitelist(actions);
    expect(result[0].type).toBe('heartbeat_finding');
    expect(result[0].params.original_action).toBe('dispatch_task');
    expect(result[0].params.blocked_reason).toBe('heartbeat_whitelist');
    expect(result[0].params.task_id).toBe('123');
  });

  it('多个非白名单 action 全部被转换', () => {
    const actions = [
      { type: 'dispatch_task', params: {} },
      { type: 'mark_task_failed', params: {} },
      { type: 'retry_task', params: {} },
    ];
    const result = enforceWhitelist(actions);
    expect(result.every(a => a.type === 'heartbeat_finding')).toBe(true);
    expect(result[0].params.original_action).toBe('dispatch_task');
    expect(result[1].params.original_action).toBe('mark_task_failed');
    expect(result[2].params.original_action).toBe('retry_task');
  });

  it('混合白名单和非白名单 action', () => {
    const actions = [
      { type: 'no_action' },
      { type: 'dispatch_task', params: {} },
      { type: 'heartbeat_finding', params: { msg: 'ok' } },
    ];
    const result = enforceWhitelist(actions);
    expect(result[0].type).toBe('no_action');
    expect(result[1].type).toBe('heartbeat_finding');
    expect(result[1].params.original_action).toBe('dispatch_task');
    expect(result[2].type).toBe('heartbeat_finding');
    expect(result[2].params.msg).toBe('ok');
  });

  it('使用 action 字段（而非 type）的 action 也被检查', () => {
    const actions = [
      { action: 'kill_process', params: {} },
    ];
    const result = enforceWhitelist(actions);
    expect(result[0].type).toBe('heartbeat_finding');
    expect(result[0].params.original_action).toBe('kill_process');
  });

  it('空 actions 数组返回空数组', () => {
    expect(enforceWhitelist([])).toEqual([]);
  });

  it('保留原始 params 中的其他字段', () => {
    const actions = [
      { type: 'adjust_strategy', params: { strategy: 'aggressive', reason: 'test' } },
    ];
    const result = enforceWhitelist(actions);
    expect(result[0].params.strategy).toBe('aggressive');
    expect(result[0].params.reason).toBe('test');
    expect(result[0].params.original_action).toBe('adjust_strategy');
  });
});
