/**
 * Task Quality Gate 测试
 * DoD: D3, D4
 */

import { describe, it, expect } from 'vitest';
import { validateTaskDescription, MIN_DESCRIPTION_LENGTH, ACTION_KEYWORDS } from '../task-quality-gate.js';

describe('D3: validateTaskDescription', () => {
  it('rejects description shorter than MIN_DESCRIPTION_LENGTH', () => {
    const result = validateTaskDescription('太短了');
    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
    expect(result.reasons[0]).toContain('长度');
  });

  it('rejects null/undefined description', () => {
    expect(validateTaskDescription(null).valid).toBe(false);
    expect(validateTaskDescription(undefined).valid).toBe(false);
    expect(validateTaskDescription('').valid).toBe(false);
  });

  it('rejects description missing action keywords', () => {
    // 长度足够，但没有行动关键词
    const desc = 'x'.repeat(MIN_DESCRIPTION_LENGTH + 10);
    const result = validateTaskDescription(desc);
    expect(result.valid).toBe(false);
    expect(result.reasons.some(r => r.includes('行动关键词'))).toBe(true);
  });

  it('accepts valid description with Chinese keywords', () => {
    const desc = '请修改 brain/src/tick.js 文件，添加新的定时任务检查逻辑。' +
      '验收标准：1. 每小时触发一次健康检查。2. 结果写入 cecelia_events 表。' +
      '3. 测试覆盖正向和负向路径。4. 新增对应的 vitest 单元测试文件。';
    expect(desc.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_LENGTH);
    const result = validateTaskDescription(desc);
    expect(result.valid).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('accepts valid description with English keywords', () => {
    const desc = 'Implement a new API endpoint at /api/brain/kr-progress that returns ' +
      'the current progress of all active KRs. The endpoint should query the goals table ' +
      'and calculate progress from initiative completion ratios. Add integration tests.';
    const result = validateTaskDescription(desc);
    expect(result.valid).toBe(true);
  });

  it('accepts description with "拆解" keyword', () => {
    const desc = '请为 Initiative「I1: 数据收集与模式识别」拆解具体的 Tasks。' +
      '要求：1. 分析 Initiative 的范围，创建 1-5 个 Task。' +
      '2. 每个 Task 约 20 分钟可完成。3. 为每个 Task 写完整 PRD。';
    const result = validateTaskDescription(desc);
    expect(result.valid).toBe(true);
  });

  it('exports MIN_DESCRIPTION_LENGTH as 100', () => {
    expect(MIN_DESCRIPTION_LENGTH).toBe(100);
  });

  it('exports ACTION_KEYWORDS as non-empty array', () => {
    expect(ACTION_KEYWORDS.length).toBeGreaterThan(10);
    expect(ACTION_KEYWORDS).toContain('文件');
    expect(ACTION_KEYWORDS).toContain('API');
  });
});
