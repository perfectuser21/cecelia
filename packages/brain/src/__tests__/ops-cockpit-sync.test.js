import { describe, it, expect } from 'vitest';
import {
  buildOpsWorkflowNotionProperties,
  buildOpsManualReadback,
  effectiveStage,
} from '../notion-push-sync.js';

// 驾驶舱三条规矩（决策：机器列单向 / 人工列回写 / 失联自动判定）：
//   1. 机器列 Brain→Notion 每轮覆盖
//   2. 人工列 Notion→Brain 单向读回，推送永不发这些列（否则把人改的冲掉）
//   3. 活性要一眼可见，不能让人自己拿最后运行时间去减
describe('buildOpsWorkflowNotionProperties — 活性列上看板', () => {
  const base = { name: '智能获客', source: 'n8n', active: true, stage_count: 8 };

  it('失联流程推出红灯 + 人话静默时长，不用人自己算', () => {
    const p = buildOpsWorkflowNotionProperties({
      ...base, liveness: 'dead', silent_sec: 73440,
      baseline_interval_sec: 4200, warn_after_sec: 21000, dead_after_sec: 84000,
    });
    expect(p.Liveness.select.name).toBe('🔴 失联');
    expect(p.SilentFor.rich_text[0].text.content).toBe('停了 20.4 小时');
  });

  it('四态各有对应灯色', () => {
    const at = (lv) => buildOpsWorkflowNotionProperties({ ...base, liveness: lv, silent_sec: 60 }).Liveness.select.name;
    expect(at('ok')).toBe('🟢 正常');
    expect(at('warn')).toBe('🟡 放缓');
    expect(at('dead')).toBe('🔴 失联');
    expect(at('cold')).toBe('⚪ 数据不足');
  });

  it('静默时长按量级换单位（秒/分/小时/天），不出现「停了 0.0 小时」', () => {
    const at = (sec) => buildOpsWorkflowNotionProperties({ ...base, liveness: 'ok', silent_sec: sec })
      .SilentFor.rich_text[0].text.content;
    expect(at(45)).toBe('停了 45 秒');
    expect(at(600)).toBe('停了 10 分钟');
    expect(at(7200)).toBe('停了 2.0 小时');
    expect(at(200000)).toBe('停了 2.3 天');
  });

  it('无活性数据时不发这两列（避免显示假值）', () => {
    const p = buildOpsWorkflowNotionProperties(base);
    expect(p.Liveness).toBeUndefined();
    expect(p.SilentFor).toBeUndefined();
  });

  it('推送绝不发人工列——发了会把主理人在 Notion 改的冲掉', () => {
    const p = buildOpsWorkflowNotionProperties({
      ...base, owner_manual: '张三', note_manual: '备注', priority_manual: 'P0',
      starred: true, enable_intent: false,
    });
    expect(p.Owner).toBeUndefined();
    expect(p.Note).toBeUndefined();
    expect(p.Priority).toBeUndefined();
    expect(p.Starred).toBeUndefined();
    expect(p.Enabled).toBeUndefined();
  });

  it('n8n 真实启用态仍然推（Active 是机器列，跟人工意图 enable_intent 不是一回事）', () => {
    const p = buildOpsWorkflowNotionProperties({ ...base, active: false, enable_intent: true });
    expect(p.Active.checkbox).toBe(false);
  });
});

describe('buildOpsManualReadback — 从 Notion 页面读回人工列', () => {
  const page = (props) => ({ properties: props });

  it('读出归属身份四件套', () => {
    const r = buildOpsManualReadback(page({
      Owner: { rich_text: [{ plain_text: '悦升号' }] },
      Note: { rich_text: [{ plain_text: '重点盯' }] },
      Priority: { select: { name: 'P1' } },
      Starred: { checkbox: true },
    }));
    expect(r).toEqual({ owner_manual: '悦升号', note_manual: '重点盯', priority_manual: 'P1', starred: true });
  });

  it('机器列即使人在 Notion 改了也一律不读回（下一轮推送会覆盖回去）', () => {
    const r = buildOpsManualReadback(page({
      Runs: { number: 99999 },
      SuccessRate: { number: 100 },
      Liveness: { select: { name: '🟢 正常' } },
      Owner: { rich_text: [{ plain_text: '张三' }] },
    }));
    expect(r).toEqual({ owner_manual: '张三' });
  });

  it('空值读成 null 而不是跳过——人清空一个字段必须能传达到 Brain', () => {
    const r = buildOpsManualReadback(page({
      Owner: { rich_text: [] },
      Priority: { select: null },
      Starred: { checkbox: false },
    }));
    expect(r.owner_manual).toBeNull();
    expect(r.priority_manual).toBeNull();
    expect(r.starred).toBe(false);
  });

  it('DisCo 人工档位只认合法值，乱填忽略（防把档位写脏）', () => {
    expect(buildOpsManualReadback(page({ Stage: { select: { name: 'disco' } } })).stage_manual).toBe('disco');
    expect(buildOpsManualReadback(page({ Stage: { select: { name: '随便写的' } } })).stage_manual).toBeUndefined();
  });

  it('停用意图读成布尔（主理人拍板直接生效，这个值会被拿去调 n8n）', () => {
    expect(buildOpsManualReadback(page({ Enabled: { checkbox: false } })).enable_intent).toBe(false);
    expect(buildOpsManualReadback(page({ Enabled: { checkbox: true } })).enable_intent).toBe(true);
  });

  it('空页面 → 空对象，不抛', () => {
    expect(buildOpsManualReadback(page({}))).toEqual({});
    expect(buildOpsManualReadback({})).toEqual({});
    expect(buildOpsManualReadback(null)).toEqual({});
  });
});

describe('effectiveStage — 生效档位取人工优先', () => {
  it('人工填了就用人工的（主理人能推翻自动判定）', () => {
    expect(effectiveStage({ disco_stage: 'software3', stage_manual: 'disco' })).toBe('disco');
  });
  it('人工空则用自动的', () => {
    expect(effectiveStage({ disco_stage: 'software3', stage_manual: null })).toBe('software3');
  });
  it('两个都空 → null', () => {
    expect(effectiveStage({})).toBeNull();
  });
});
