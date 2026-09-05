import { describe, it, expect } from 'vitest';
import { buildOpsAgentNotionProperties, buildOpsScheduleNotionProperties, isMissingDatabaseError } from '../notion-push-sync.js';

describe('buildOpsAgentNotionProperties（纯函数 oracle）', () => {
  it('全字段映射', () => {
    const p = buildOpsAgentNotionProperties({
      source: 'openclaw', host_alias: 'hk-vps', name: 'main', agent_type: 'openclaw_agent',
      status: 'active', last_seen_at: new Date('2026-09-05T12:00:00Z'),
    });
    expect(p.Name.title[0].text.content).toBe('main');
    expect(p.Source.select.name).toBe('openclaw');
    expect(p.Host.select.name).toBe('hk-vps');
    expect(p.Status.select.name).toBe('active');
    expect(p.LastSeen.date.start).toBe('2026-09-05T12:00:00.000Z');
  });
  it('last_seen_at 空 → 不发 LastSeen（禁假数据）', () => {
    const p = buildOpsAgentNotionProperties({ source: 's', host_alias: 'h', name: 'n', status: 'offline', last_seen_at: null });
    expect(p.LastSeen).toBeUndefined();
    expect(p.Status.select.name).toBe('offline');
  });
});

describe('buildOpsScheduleNotionProperties', () => {
  it('suspicious/active 透出为 checkbox，next_run 空不发', () => {
    const p = buildOpsScheduleNotionProperties({
      source: 'brain', host_alias: 'local', label: 'X', kind: 'brain_recurring',
      schedule_desc: '0 3 * * *', next_run_utc: null, last_state: null, active: true,
    }, true);
    expect(p.Suspicious.checkbox).toBe(true);
    expect(p.Active.checkbox).toBe(true);
    expect(p.NextRun).toBeUndefined();
    expect(p.Kind.select.name).toBe('brain_recurring');
    expect(p.Schedule.rich_text[0].text.content).toBe('0 3 * * *');
  });
});

describe('isMissingDatabaseError', () => {
  it('database 级 404 识别（page 级不算）', () => {
    expect(isMissingDatabaseError(new Error('Could not find database with ID: xxx'))).toBe(true);
    expect(isMissingDatabaseError(new Error('Could not find page with ID: yyy'))).toBe(false);
    expect(isMissingDatabaseError(null)).toBe(false);
  });
});
