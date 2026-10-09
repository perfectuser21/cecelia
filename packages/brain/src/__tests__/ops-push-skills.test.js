import { describe, it, expect } from 'vitest';
import { buildOpsSkillNotionProperties } from '../notion-push-sync.js';

// Skills 库此前无任何推送代码，19 条 notion_id 是早前一次性手动灌的，数据停在凌晨。
// 主理人要的「DisCo 档位人工覆盖」落在这个库，推不上去等于双向只有一半。
describe('buildOpsSkillNotionProperties — 技能池机器列', () => {
  const s = {
    name: 'douyin-phone-runtime', source: 'openclaw',
    used_by: ['a', 'b', 'c'], generation: 2, eval_score: 8.5,
    runs: 24, run_success_rate: 100, run_avg_sec: 7,
    disco_stage: 'disco', stage_reason: '执行 24 次、成功率 100%、有探针',
    has_postcondition: true,
  };

  it('推出档位与判定依据——只给档位不给理由，人没法判断该不该推翻它', () => {
    const p = buildOpsSkillNotionProperties(s);
    expect(p.DiscoStage.select.name).toBe('disco');
    expect(p.StageReason.rich_text[0].text.content).toContain('24 次');
    expect(p.HasProbe.checkbox).toBe(true);
  });

  it('运行统计与共用 agent 数', () => {
    const p = buildOpsSkillNotionProperties(s);
    expect(p.Runs.number).toBe(24);
    expect(p.SuccessRate.number).toBe(100);
    expect(p.AvgSeconds.number).toBe(7);
    expect(p.UsedBy.number).toBe(3);
    expect(p.Generation.number).toBe(2);
    expect(p.EvalScore.number).toBe(8.5);
  });

  it('无运行数据的 skill 不发假 0（19 个里 17 个没数据）', () => {
    const p = buildOpsSkillNotionProperties({ name: 'x', source: 'openclaw', used_by: [] });
    expect(p.Runs).toBeUndefined();
    expect(p.SuccessRate).toBeUndefined();
    expect(p.AvgSeconds).toBeUndefined();
    expect(p.EvalScore).toBeUndefined();
    expect(p.UsedBy.number).toBe(0);
  });

  it('探针未知（null）不发 checkbox——false 会被误读成"确认没有探针"', () => {
    const p = buildOpsSkillNotionProperties({ name: 'x', source: 'openclaw', has_postcondition: null });
    expect(p.HasProbe).toBeUndefined();
  });

  it('绝不推人工列 Stage——那是主理人推翻自动判定的地方，推了就冲掉了', () => {
    const p = buildOpsSkillNotionProperties({ ...s, stage_manual: 'code', owner_manual: '张三', starred: true });
    expect(p.Stage).toBeUndefined();
    expect(p.Owner).toBeUndefined();
    expect(p.Starred).toBeUndefined();
  });

  it('名字超长截断且不抛（Notion title 上限 2000）', () => {
    const p = buildOpsSkillNotionProperties({ name: 'x'.repeat(500), source: 'openclaw' });
    expect(p.Name.title[0].text.content.length).toBeLessThanOrEqual(200);
  });
});
