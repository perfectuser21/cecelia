import { describe, it, expect } from 'vitest';
import { buildOpsUnitNotionProperties, isMissingDatabaseError } from '../notion-push-sync.js';

describe('buildOpsUnitNotionProperties（合并单库 · 纯函数 oracle）', () => {
  it('agent 行全字段：role/workflow/schedule/机器', () => {
    const p = buildOpsUnitNotionProperties({
      source: 'openclaw', host_alias: 'hk-vps', name: 'dev', agent_type: 'openclaw_agent',
      status: 'active', last_seen_at: new Date('2026-09-05T12:00:00Z'),
      role: 'member', orchestrated_by: ['main', 'work-commander'],
      kind: null, schedule_desc: null, next_run_utc: null,
    });
    expect(p.Name.title[0].text.content).toBe('dev');
    expect(p.Source.select.name).toBe('openclaw');
    expect(p.Machine.select.name).toBe('hk-vps');
    expect(p.Status.select.name).toBe('active');
    expect(p.Role.select.name).toBe('member');
    expect(p.Workflow.rich_text[0].text.content).toBe('main, work-commander');
    expect(p.LastSeen.date.start).toBe('2026-09-05T12:00:00.000Z');
    expect(p.Schedule).toBeUndefined(); // 常驻 agent 无调度
    expect(p.Repeat.checkbox).toBe(false);
  });

  it('orchestrator 无父 → Workflow 不发', () => {
    const p = buildOpsUnitNotionProperties({
      source: 'openclaw', host_alias: 'hk-vps', name: 'main', status: 'active',
      role: 'orchestrator', orchestrated_by: [], last_seen_at: null,
    });
    expect(p.Role.select.name).toBe('orchestrator');
    expect(p.Workflow).toBeUndefined();
    expect(p.LastSeen).toBeUndefined();
  });

  it('定时行：Schedule 有值 + Repeat=true + NextRun', () => {
    const p = buildOpsUnitNotionProperties({
      source: 'launchd', host_alias: 'local', name: 'com.cecelia.backup-db', status: 'active',
      role: 'solo', orchestrated_by: [], kind: 'launchd_calendar',
      schedule_desc: 'calendar 3:30', next_run_utc: new Date('2026-09-06T10:30:00Z'),
      last_seen_at: new Date('2026-09-05T12:00:00Z'),
    });
    expect(p.Schedule.rich_text[0].text.content).toBe('calendar 3:30');
    expect(p.Repeat.checkbox).toBe(true);
    expect(p.NextRun.date.start).toBe('2026-09-06T10:30:00.000Z');
    expect(p.Role.select.name).toBe('solo');
  });

  it('suspicious 死排程透出 checkbox', () => {
    const p = buildOpsUnitNotionProperties({
      source: 'brain', host_alias: 'local', name: '死的', status: 'active',
      role: 'scheduled', orchestrated_by: [], kind: 'brain_recurring',
      schedule_desc: '0 4 * * *', next_run_utc: null, suspicious: true, last_seen_at: null,
    });
    expect(p.Suspicious.checkbox).toBe(true);
    expect(p.NextRun).toBeUndefined();
  });
});

describe('isMissingDatabaseError', () => {
  it('database 级 404 识别（page 级不算）', () => {
    expect(isMissingDatabaseError(new Error('Could not find database with ID: xxx'))).toBe(true);
    expect(isMissingDatabaseError(new Error('Could not find page with ID: yyy'))).toBe(false);
    expect(isMissingDatabaseError(null)).toBe(false);
  });
});
