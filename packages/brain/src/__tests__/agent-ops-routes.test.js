import { describe, it, expect } from 'vitest';
import { buildAgentsPayload, buildCalendarPayload, SKILL_BY_TASK_TYPE } from '../routes/agent-ops.js';

function poolReturning(rowsBySql) {
  return { query: async (sql) => {
    for (const [key, rows] of Object.entries(rowsBySql)) if (sql.includes(key)) return { rows };
    return { rows: [] };
  } };
}

describe('buildAgentsPayload', () => {
  it('per-source freshness：hk 心跳过期只灰 openclaw，launchd 保持 fresh', async () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const pool = poolReturning({
      'FROM ops_agents': [
        { source: 'openclaw', host_alias: 'hk-vps', name: 'main', status: 'active' },
        { source: 'launchd', host_alias: 'local', name: 'com.cecelia.backup-db', status: 'active' },
      ],
      'FROM ops_source_heartbeats': [
        { source: 'openclaw', host_alias: 'hk-vps', last_report_at: new Date('2026-09-05T10:00:00Z'), source_status: 'ok' },
        { source: 'launchd', host_alias: 'local', last_report_at: new Date('2026-09-05T11:58:00Z'), source_status: 'ok' },
      ],
    });
    const p = await buildAgentsPayload(pool, now);
    const oc = p.sources.find((s) => s.source === 'openclaw');
    const ld = p.sources.find((s) => s.source === 'launchd');
    expect(oc.stale).toBe(true);
    expect(ld.stale).toBe(false);
    expect(p.agents.find((a) => a.source === 'openclaw').stale).toBe(true);
    expect(p.global_stale).toBe(false);
  });
  it('source_status 非 ok 即 stale（哪怕心跳新鲜），失败原因透出', async () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const pool = poolReturning({
      'FROM ops_agents': [],
      'FROM ops_source_heartbeats': [
        { source: 'openclaw', host_alias: 'hk-vps', last_report_at: now, source_status: 'unreachable', reason_code: 'ssh_or_exec_failed', last_error: 'ssh: connect timeout' },
      ],
    });
    const p = await buildAgentsPayload(pool, now);
    expect(p.sources[0].stale).toBe(true);
    expect(p.sources[0].last_error).toContain('timeout');
    expect(p.global_stale).toBe(true);
  });
  it('表不存在(42P01) → 抛 migration_pending 语义错误', async () => {
    const pool = { query: async () => { const e = new Error('relation "ops_agents" does not exist'); e.code = '42P01'; throw e; } };
    await expect(buildAgentsPayload(pool, new Date())).rejects.toMatchObject({ reason_code: 'migration_pending' });
  });
});

describe('buildCalendarPayload', () => {
  it('合并实跑+排程+recurring；死排程标 suspicious 禁绿灯', async () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const pool = poolReturning({
      'FROM tasks': [{ id: 't1', title: 'X', task_type: 'dev', status: 'completed', location: 'us', updated_at: now }],
      'FROM ops_schedule_entries': [{ source: 'launchd', host_alias: 'local', label: 'com.cecelia.backup-db', kind: 'launchd_calendar', schedule_desc: 'c', next_run_utc: now, last_state: 'ok', active: true }],
      'FROM recurring_tasks': [
        { title: '活的', cron_expression: '0 3 * * *', last_run_at: new Date('2026-09-05T03:00:00Z'), next_run_at: null, last_run_status: 'ok', is_active: true },
        { title: '死的', cron_expression: '0 4 * * *', last_run_at: new Date('2026-08-01T00:00:00Z'), next_run_at: null, last_run_status: null, is_active: true },
      ],
    });
    const p = await buildCalendarPayload(pool, now);
    expect(p.runs.length).toBe(1);
    expect(p.runs[0].skill).toBe('/dev');
    expect(p.runs[0].machine).toBe('us');
    const dead = p.schedules.find((s) => s.label === '死的');
    expect(dead.suspicious).toBe(true);
    expect(dead.kind).toBe('brain_recurring');
    expect(p.schedules.find((s) => s.label === '活的').suspicious).toBe(false);
  });
  it('task_type 映射不出 → skill 为 null（禁编造）', async () => {
    expect(SKILL_BY_TASK_TYPE['dev']).toBe('/dev');
    expect(SKILL_BY_TASK_TYPE['不存在的类型']).toBeUndefined();
    const now = new Date('2026-09-05T12:00:00Z');
    const pool = poolReturning({ 'FROM tasks': [{ id: 't2', title: 'Y', task_type: '奇怪类型', status: 'failed', location: null, updated_at: now }] });
    const p = await buildCalendarPayload(pool, now);
    expect(p.runs[0].skill).toBeNull();
    expect(p.runs[0].machine).toBeNull();
  });
});
