/**
 * Skill 台账投影 PR1b：Notion 列定义 / 取值映射 / 指纹（纯函数）。
 * 机器列 Brain 单向覆盖，人管列三方基线合并（决策 19391396 / 判定点 24736022）。
 */
import { describe, it, expect } from 'vitest';
import {
  COLUMNS, machineValues, humanValues, machineDigest, toNotionProp, fromNotionProp, sameValue, buildProps, buildBusinessLabels,
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

describe('规范业务归属投影', () => {
  const ownership = {
    areas: [{ id: 'area-1', name: '新媒体部' }],
    value_streams: [{ id: 'stream-1', name: '内容生产' }],
    capabilities: [{ id: 'cap-1', name: '多平台发布' }],
    workflows: [{ id: 'wf-1', name: '抖音 · 视频发布' }],
    paths: [{
      area: { id: 'area-1', name: '新媒体部' },
      value_stream: { id: 'stream-1', name: '内容生产' },
      capability: { id: 'cap-1', name: '多平台发布' },
      workflow: { id: 'wf-1', name: '抖音 · 视频发布' },
    }],
    status: 'mapped', gaps: [],
  };

  it('业务归属是独立机器列，保留旧人工分类和 Area 关系', () => {
    for (const key of ['businessAreas', 'valueStreams', 'capabilities', 'businessWorkflows', 'ownershipPaths', 'ownershipStatus', 'agentAssignmentStatus']) {
      expect(COLUMNS.find(c => c.key === key)?.owner).toBe('machine');
    }
    expect(COLUMNS.some(c => ['Area', 'Journeys', 'Features'].includes(c.name))).toBe(false);
    expect(humanValues({ ...row, business_ownership: ownership }).category).toBe('运维');
  });

  it('部门、价值流、能力、流程保持完整对应路径，Agent 使用明确分配', () => {
    const values = machineValues({ ...row, assigned_agents: ['media'], business_ownership: ownership });
    expect(values.businessAreas).toEqual(['新媒体部']);
    expect(values.valueStreams).toEqual(['内容生产']);
    expect(values.capabilities).toEqual(['多平台发布']);
    expect(values.businessWorkflows).toEqual(['抖音 · 视频发布']);
    expect(values.ownershipPaths).toContain('新媒体部 → 内容生产 → 多平台发布 → 抖音 · 视频发布');
    expect(values.ownershipStatus).toBe('已归属');
    expect(values.agentAssignmentStatus).toBe('已分配');
  });

  it('没有规范绑定或明确 Agent 时，不借安装平台猜归属', () => {
    const values = machineValues({ ...row, platforms_installed: ['openclaw'], assigned_agents: [] });
    expect(values.businessAreas).toEqual([]);
    expect(values.capabilities).toEqual([]);
    expect(values.ownershipStatus).toBe('待归属');
    expect(values.agentAssignmentStatus).toBe('待分配');
  });

  it('树归属或名字改变，即使 Skill 原文没变，也必须触发新的推送指纹', () => {
    const first = machineDigest(machineValues({ ...row, business_ownership: ownership }));
    const renamed = { ...ownership, capabilities: [{ id: 'cap-1', name: '正式多平台发布' }] };
    expect(machineDigest(machineValues({ ...row, business_ownership: renamed }))).not.toBe(first);
    expect(machineDigest(machineValues(row))).not.toBe(first);
  });

  it('同名部门或过长标签不会把不同规范UUID合并成一个Notion分组', () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const labelMap = buildBusinessLabels(new Map(ids.map(id => [id, {
      areas: [{ id, name: '研发部' }], value_streams: [], capabilities: [], workflows: [],
    }])));
    expect(labelMap.areas[ids[0]]).not.toBe(labelMap.areas[ids[1]]);
    expect(labelMap.areas[ids[0]]).toContain(ids[0]);
    const long = buildBusinessLabels(new Map([[ids[0], { areas: [{ id: ids[0], name: '甲'.repeat(120) }] }]]));
    expect(long.areas[ids[0]].length).toBeLessThanOrEqual(100);
    expect(long.areas[ids[0]]).toContain(ids[0]);
  });

  it('字面名称撞上生成的UUID后缀时，最终标签及投影仍保留三个独立身份', () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
    const areas = ids.map((id, index) => ({ id, name: index === 2 ? `发布 [${ids[0]}]` : '发布' }));
    const grouped = new Map([['skill', { areas }]]);
    const labelMap = buildBusinessLabels(grouped);
    expect(new Set(Object.values(labelMap.areas)).size).toBe(3);
    expect(labelMap.areas[ids[0]]).not.toBe(labelMap.areas[ids[2]]);
    expect(Object.values(labelMap.areas).every(label => label.length <= 100)).toBe(true);
    expect(buildBusinessLabels(new Map([['skill', { areas: [...areas].reverse() }]]))).toEqual(labelMap);
    const values = machineValues({ ...row, business_ownership: { areas, status: 'mapped' }, business_labels: labelMap });
    expect(values.businessAreas).toHaveLength(3);
  });
});
