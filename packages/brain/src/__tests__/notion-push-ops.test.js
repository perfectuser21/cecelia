import { describe, it, expect } from 'vitest';
import { buildOpsUnitNotionProperties, buildOpsRelationProperties, isMissingDatabaseError } from '../notion-push-sync.js';

describe('buildOpsUnitNotionProperties（第一阶段：建页，不含 relation）', () => {
  it('agent 行基础字段（Workflow/Members 不在此阶段发——relation 需目标页 id）', () => {
    const p = buildOpsUnitNotionProperties({
      source: 'openclaw', host_alias: 'hk-vps', name: 'dev', agent_type: 'openclaw_agent',
      status: 'active', last_seen_at: new Date('2026-09-05T12:00:00Z'),
      role: 'member', orchestrated_by: ['main', 'work-commander'],
      kind: null, schedule_desc: null, next_run_utc: null,
    });
    expect(p.Name.title[0].text.content).toBe('dev');
    expect(p.Source.select.name).toBe('openclaw');
    expect(p.Machine.select.name).toBe('hk-vps');
    expect(p.Role.select.name).toBe('member');
    expect(p.LastSeen.date.start).toBe('2026-09-05T12:00:00.000Z');
    expect(p.Repeat.checkbox).toBe(false);
    expect(p.Workflow).toBeUndefined();  // relation 在第二阶段补
    expect(p.Members).toBeUndefined();
  });

  it('Kind 列已删（45/67 为空，信息量太低）', () => {
    const p = buildOpsUnitNotionProperties({
      source: 'gha', host_alias: 'github', name: 'nightly.yml', status: 'active',
      role: 'scheduled', kind: 'gha_cron', schedule_desc: 'cron 0 19 * * *',
    });
    expect(p.Kind).toBeUndefined();
    expect(p.Schedule.rich_text[0].text.content).toBe('cron 0 19 * * *');
    expect(p.Repeat.checkbox).toBe(true);
  });

  it('定时行：Schedule + Repeat + NextRun', () => {
    const p = buildOpsUnitNotionProperties({
      source: 'launchd', host_alias: 'local', name: 'com.cecelia.backup-db', status: 'active',
      role: 'solo', schedule_desc: 'calendar 3:30',
      next_run_utc: new Date('2026-09-06T10:30:00Z'), last_seen_at: null,
    });
    expect(p.Schedule.rich_text[0].text.content).toBe('calendar 3:30');
    expect(p.Repeat.checkbox).toBe(true);
    expect(p.NextRun.date.start).toBe('2026-09-06T10:30:00.000Z');
    expect(p.LastSeen).toBeUndefined();
  });
});

describe('buildOpsRelationProperties（第二阶段：同库 relation 自关联）', () => {
  // name → notion page id 映射（第一阶段建页后得到）
  const idByName = new Map([
    ['main', 'page-main'], ['work-commander', 'page-wc'], ['dev', 'page-dev'],
    ['curator', 'page-curator'],
  ]);

  it('Members = 它编排谁（relation 指向本库）', () => {
    const p = buildOpsRelationProperties({ name: 'work-commander', orchestrates: ['dev', 'curator'] }, idByName);
    expect(p.Members.relation).toEqual([{ id: 'page-dev' }, { id: 'page-curator' }]);
  });

  it('共享 agent：dev 被 main+work-commander 编排 → 两个父各自的 Members 都含 dev', () => {
    const pm = buildOpsRelationProperties({ name: 'main', orchestrates: ['dev'] }, idByName);
    const pw = buildOpsRelationProperties({ name: 'work-commander', orchestrates: ['dev'] }, idByName);
    expect(pm.Members.relation).toEqual([{ id: 'page-dev' }]);
    expect(pw.Members.relation).toEqual([{ id: 'page-dev' }]);
    // Workflow 反向由 Notion dual_property 自动生成，不手工发
    expect(pm.Workflow).toBeUndefined();
  });

  it('无下级 → Members 发空数组（清掉可能的历史残留）', () => {
    const p = buildOpsRelationProperties({ name: 'curator', orchestrates: [] }, idByName);
    expect(p.Members.relation).toEqual([]);
  });

  it('下级页尚未建（不在映射里）→ 跳过该项，不发 undefined id', () => {
    const p = buildOpsRelationProperties({ name: 'main', orchestrates: ['dev', '还没建的'] }, idByName);
    expect(p.Members.relation).toEqual([{ id: 'page-dev' }]);
  });
});

describe('isMissingDatabaseError', () => {
  it('database 级 404 识别（page 级不算）', () => {
    expect(isMissingDatabaseError(new Error('Could not find database with ID: xxx'))).toBe(true);
    expect(isMissingDatabaseError(new Error('Could not find page with ID: yyy'))).toBe(false);
    expect(isMissingDatabaseError(null)).toBe(false);
  });
});
