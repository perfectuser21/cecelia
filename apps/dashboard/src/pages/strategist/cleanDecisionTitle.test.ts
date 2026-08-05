/**
 * cleanDecisionTitle — 拍板项标题清洗（残差修复 ee7170d3）
 * 历史病：军师任务标题「Line 军师决策 — journey <uuid>」uuid 裸奔进 UI（两轮对版验收实拍）。
 */
import { describe, it, expect } from 'vitest';
import { cleanDecisionTitle } from './StrategistLinePage';

describe('cleanDecisionTitle', () => {
  it('剥掉 — journey <uuid> 尾巴', () => {
    expect(
      cleanDecisionTitle('Line 军师决策 — journey 8bb8252f-29b4-4c34-acb9-1accda7ddfcf')
    ).toBe('Line 军师决策');
  });

  it('剥掉非 uuid 短 id 的 journey 尾巴（codex-slot 等命名 journey）', () => {
    expect(
      cleanDecisionTitle('Line 军师决策 — journey bb8cc561-b3ee-4fec-b74d-2255694bd963')
    ).toBe('Line 军师决策');
  });

  it('纯 uuid 标题降级到 description', () => {
    expect(
      cleanDecisionTitle('8bb8252f-29b4-4c34-acb9-1accda7ddfcf', '任务终态触发，分析近期完成/失败')
    ).toBe('任务终态触发，分析近期完成/失败');
  });

  it('纯 uuid 且无 description → 兜底文案', () => {
    expect(cleanDecisionTitle('8bb8252f-29b4-4c34-acb9-1accda7ddfcf')).toBe('军师决策');
  });

  it('正常标题原样保留', () => {
    expect(cleanDecisionTitle('恢复 codex smoke（等 team5 拍板）')).toBe('恢复 codex smoke（等 team5 拍板）');
  });
});
