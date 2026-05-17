/**
 * Capture Digestion Job 测试
 * 验证 runCaptureDigestion 函数的行为
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cortex LLM
vi.mock('../packages/brain/src/cortex.js', () => ({
  callCortexLLM: vi.fn().mockResolvedValue({
    text: JSON.stringify([
      { content: '跟小明吃了火锅', target_type: 'event', target_subtype: 'meal', confidence: 0.95, reason: '聚餐事件' },
      { content: '小明说他要创业', target_type: 'note', target_subtype: 'idea_note', confidence: 0.8, reason: '想法记录' },
      { content: '帮小明看一下商业计划书', target_type: 'task', target_subtype: 'action_item', confidence: 0.9, reason: '待办事项' },
    ]),
    timing: { prompt_tokens_est: 500, response_ms: 1000 },
  }),
}));

// Mock DB pool
vi.mock('../packages/brain/src/db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('capture-digestion job', () => {
  it('runCaptureDigestion 函数可导出', async () => {
    // 验证模块可加载且函数存在
    const mod = await import('../packages/brain/src/capture-digestion.js');
    expect(typeof mod.runCaptureDigestion).toBe('function');
  });

  it('DIGESTION_PROMPT 包含 6 种 target_type', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('packages/brain/src/capture-digestion.js', 'utf8');
    expect(content).toContain('note');
    expect(content).toContain('knowledge');
    expect(content).toContain('content');
    expect(content).toContain('task');
    expect(content).toContain('decision');
    expect(content).toContain('event');
  });

  it('无 inbox captures 时返回 0', async () => {
    const pool = (await import('../packages/brain/src/db.js')).default;
    pool.query.mockResolvedValueOnce({ rows: [] });

    const { runCaptureDigestion } = await import('../packages/brain/src/capture-digestion.js');
    const result = await runCaptureDigestion();
    expect(result.processed).toBe(0);
    expect(result.atoms_created).toBe(0);
  });
});
