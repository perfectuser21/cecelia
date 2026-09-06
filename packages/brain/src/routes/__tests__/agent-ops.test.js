import { describe, it, expect } from 'vitest';
import { buildAgentsPayload, buildCalendarPayload, buildGraphPayload, computeAgentRole, SKILL_BY_TASK_TYPE } from '../agent-ops.js';

describe('computeAgentRole', () => {
  it('orchestrates 非空 → orchestrator（即使也被编排）', () => {
    expect(computeAgentRole(['dev', 'infra'], ['main'])).toBe('orchestrator');
  });
  it('只被编排不编排 → member', () => {
    expect(computeAgentRole([], ['main', 'work-commander'])).toBe('member');
  });
  it('都不 → solo', () => {
    expect(computeAgentRole([], [])).toBe('solo');
  });
});

describe('buildGraphPayload', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  function graphPool() {
    return poolReturning({
      'FROM ops_agents': [
        { source: 'openclaw', host_alias: 'hk-vps', name: 'main', status: 'active', last_seen_at: now, meta: { orchestrates: ['dev', 'work-commander'] } },
        { source: 'openclaw', host_alias: 'hk-vps', name: 'work-commander', status: 'active', last_seen_at: now, meta: { orchestrates: ['dev'] } },
        { source: 'openclaw', host_alias: 'hk-vps', name: 'dev', status: 'active', last_seen_at: now, meta: { orchestrates: [] } },
        { source: 'openclaw', host_alias: 'hk-vps', name: 'curator', status: 'active', last_seen_at: now, meta: { orchestrates: [] } },
        { source: 'launchd', host_alias: 'local', name: 'com.cecelia.backup-db', status: 'active', last_seen_at: now, meta: {} },
      ],
      'FROM ops_schedule_entries': [
        { source: 'launchd', host_alias: 'local', label: 'com.cecelia.backup-db', kind: 'launchd_calendar', schedule_desc: 'calendar 3:30', next_run_utc: now, active: true },
        { source: 'gha', host_alias: 'github', label: 'cecelia/nightly.yml', kind: 'gha_cron', schedule_desc: 'cron 0 19 * * *', next_run_utc: null, active: true },
      ],
      'FROM ops_source_heartbeats': [
        { source: 'openclaw', host_alias: 'hk-vps', last_report_at: now, source_status: 'ok' },
        { source: 'launchd', host_alias: 'local', last_report_at: now, source_status: 'ok' },
        { source: 'gha', host_alias: 'github', last_report_at: now, source_status: 'ok' },
      ],
      'FROM recurring_tasks': [],
    });
  }

  it('role 现算：main=orchestrator, dev=member(父=main,work-commander), curator=solo', async () => {
    const p = await buildGraphPayload(graphPool(), now);
    const byName = Object.fromEntries(p.units.map((u) => [u.name, u]));
    expect(byName['main'].role).toBe('orchestrator');
    expect(byName['work-commander'].role).toBe('orchestrator');
    expect(byName['dev'].role).toBe('member');
    expect(byName['dev'].orchestrated_by.sort()).toEqual(['main', 'work-commander']);
    expect(byName['curator'].role).toBe('solo');
  });

  it('launchd agent 与 schedule 合并为一行（不重复），带调度属性', async () => {
    const p = await buildGraphPayload(graphPool(), now);
    const backup = p.units.filter((u) => u.name === 'com.cecelia.backup-db');
    expect(backup.length).toBe(1);
    expect(backup[0].schedule_desc).toContain('3:30');
    expect(backup[0].next_run_utc).toBeTruthy();
    expect(backup[0].role).toBe('solo');
  });

  it('孤儿排程（gha 无对应 agent）独立成行 role=scheduled', async () => {
    const p = await buildGraphPayload(graphPool(), now);
    const gha = p.units.find((u) => u.name === 'cecelia/nightly.yml');
    expect(gha).toBeTruthy();
    expect(gha.role).toBe('scheduled');
    expect(gha.schedule_desc).toContain('cron');
  });

  it('per-source freshness 附加到每行 + 表缺失 503', async () => {
    const p = await buildGraphPayload(graphPool(), now);
    expect(p.units.every((u) => u.stale === false)).toBe(true);
    expect(p.global_stale).toBe(false);
    const bad = { query: async () => { const e = new Error('relation "ops_agents" does not exist'); e.code = '42P01'; throw e; } };
    await expect(buildGraphPayload(bad, now)).rejects.toMatchObject({ reason_code: 'migration_pending' });
  });
});

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
