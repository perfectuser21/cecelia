/**
 * Desire Formation Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDesireFormation } from '../desire/desire-formation.js';

// Mock dependencies
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({
    text: JSON.stringify({
      type: 'act',
      content: '测试欲望内容',
      proposed_action: '执行测试动作',
      urgency: 7
    })
  })
}));

vi.mock('../unified-intent-router.js', () => ({
  identifyTaskLayer: vi.fn().mockResolvedValue('Layer 5')
}));

vi.mock('../events/taskEvents.js', () => ({
  publishDesireCreated: vi.fn()
}));

describe('Desire Formation', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'test-desire-id' }]
      })
    };
  });

  it('应该在创建 desire 时识别并存储 task_layer', async () => {
    const insight = '测试洞察：系统需要优化';

    const result = await runDesireFormation(mockPool, insight);

    expect(result.created).toBe(true);
    expect(result.desire_id).toBe('test-desire-id');

    // 验证 query 被调用，并且包含 task_layer 参数
    expect(mockPool.query).toHaveBeenCalled();
    const queryArgs = mockPool.query.mock.calls[0];
    expect(queryArgs[0]).toContain('task_layer');
    expect(queryArgs[1]).toContain('Layer 5');
  });

  it('空 insight 应该返回 created: false', async () => {
    const result = await runDesireFormation(mockPool, '');
    expect(result.created).toBe(false);
  });
});
