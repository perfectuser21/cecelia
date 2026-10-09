/**
 * Skill 台账投影 PR1b：Notion 列定义 / 取值映射 / 指纹（纯函数）。
 * 机器列 Brain 单向覆盖，人管列三方基线合并（决策 19391396 / 判定点 24736022）。
 */
import { describe, it, expect } from 'vitest';
import {
  COLUMNS, machineValues, humanValues, machineDigest, toNotionProp, fromNotionProp, sameValue, buildProps,
} from '../skill-registry-notion-props.js';

const row = {
  name: 'nas', description: 'NAS 内容管理', location: 'claude-code', status: 'active',
  metadata: { eval_score: 'EVA v2' }, platforms_installed: ['codex', 'claude-code'], presence: 'present',
  last_seen_at: new Date('2026-09-30T01:02:03Z'), source_path: '/Users/administrator/perfect21/zenithjoy-skills/nas/SKILL.md',
  source_kind: 'repo', assigned_agents: [], drift_copies: 0,
  platforms_target: ['openclaw'], openclaw_tier: null, tier_suggested: 'A', business_line: null, category: '运维', note: null,
};

describe('COLUMNS', () => {
  it('13 个新列 + 4 个原有列，机器/人管分工明确，负责人列只建不写', () => {
    const names = COLUMNS.map((c) => c.name);
    for (const n of ['Name', 'Description', 'Source', 'Status', '已装平台', '存在性', '最后扫描', '原件路径', '分配Agent',
      '评测分', '不一致副本数', '目标平台', '转OpenClaw难度', '业务线', '负责人', '分类', '备注']) {
      expect(names).toContain(n);
    }
    expect(COLUMNS.find((c) => c.name === 'Status').owner).toBe('human');
    expect(COLUMNS.find((c) => c.name === '存在性').owner).toBe('machine');
    expect(COLUMNS.find((c) => c.name === '负责人').owner).toBe('none');
  });
});

describe('取值映射', () => {
  it('机器列：平台转中文标签并排序、存在性转中文、路径缩成 ~、最后扫描只到日、评测分取原文', () => {
    const m = machineValues(row);
    expect(m.platforms).toEqual(['Claude Code', 'Codex']);
    expect(m.presence).toBe('在用');
    expect(m.sourcePath).toBe('~/perfect21/zenithjoy-skills/nas/SKILL.md');
    expect(m.lastScan).toBe('2026-09-30');
    expect(m.evalScore).toBe('EVA v2');
    expect(m.source).toBe('repo');
  });

  it('人管列：转OpenClaw难度 Brain 为空时取机器建议；目标平台转中文标签', () => {
    const h = humanValues(row);
    expect(h.tier).toBe('A');
    expect(h.targets).toEqual(['OpenClaw']);
    expect(h.category).toBe('运维');
    expect(h.status).toBe('active');
  });

  it('指纹只看机器列、键序无关；描述变了指纹变', () => {
    const a = machineDigest(machineValues(row));
    expect(machineDigest(machineValues({ ...row, note: '人写的' }))).toBe(a);
    expect(machineDigest(machineValues({ ...row, description: '改了' }))).not.toBe(a);
  });
});

describe('Notion 属性互转', () => {
  it('toNotionProp / fromNotionProp 往返一致', () => {
    const cases = [
      ['title', 'nas'], ['rich_text', '长文本'], ['select', '在用'], ['multi_select', ['Codex', 'Claude Code']],
      ['number', 3], ['date', '2026-09-30'],
    ];
    for (const [type, v] of cases) {
      const prop = { type, ...toNotionProp(type, v) };
      if (type === 'title' || type === 'rich_text') prop[type] = prop[type].map((t) => ({ plain_text: t.text.content }));
      const back = fromNotionProp(prop);
      expect(sameValue(back, v)).toBe(true);
    }
  });

  it('空值互相等价；多选忽略顺序', () => {
    expect(sameValue(null, '')).toBe(true);
    expect(sameValue(undefined, [])).toBe(true);
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameValue('a', 'b')).toBe(false);
  });

  it('rich_text 超 2000 字切块；select 空值发 null、逗号替换（Notion 选项名不许含逗号）', () => {
    const long = 'x'.repeat(4500);
    expect(toNotionProp('rich_text', long).rich_text.length).toBe(3);
    expect(toNotionProp('select', null)).toEqual({ select: null });
    expect(toNotionProp('select', 'a,b')).toEqual({ select: { name: 'a b' } });
  });
});

describe('buildProps', () => {
  it('只发列账里存在且类型匹配的列，用列当前名字（人改列名不影响）', () => {
    const colMap = { name: { name: 'Name', type: 'title' }, presence: { name: '状态（机器）', type: 'select' } };
    const props = buildProps({ name: 'nas', presence: '在用', platforms: ['Codex'] }, colMap);
    expect(Object.keys(props).sort()).toEqual(['Name', '状态（机器）']);
    expect(props['状态（机器）']).toEqual({ select: { name: '在用' } });
  });
});
