/**
 * 闹钟总账（任务 fe10d1a0，决策 9e9d90b6）：扩 ops_schedule_entries，不建新表。
 * 覆盖：cadence 换算 / 状态口径 / Brain job 与 recurring 落表 / liveness 接线 / alarms 接口 / 导入规划 / 迁移形状。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  cadenceDesc, cadenceIntervalSec, cronApproxIntervalSec, deriveLastStatus, statusFromCollectorState,
  upsertBrainJobLedger, syncRecurringLedger, deactivateRetiredBrainJobs,
} from '../ops-alarm-ledger.js';
import { buildAlarmsPayload, mechanismOf } from '../routes/agent-ops.js';
import { runSchedulerLiveness } from '../ops-scheduler-liveness.js';

const here = dirname(fileURLToPath(import.meta.url));
const MANUAL_COLS = ['owner_manual', 'note_manual', 'tree_bucket_manual'];
const TREE_COLS = ['journey_id', 'workflow_id'];
// 列名按"整词赋值"匹配：ops_workflow_id（运行实现外键，机器列）不能被 workflow_id 误伤
const assignsCol = (setPart, col) => new RegExp(`(?<![\\w])${col}\\s*=`).test(setPart);

function recordingPool(responder = () => ({ rows: [] })) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: s, params });
      return responder(s, params);
    },
  };
}

describe('cadence 换算', () => {
  it('everySec → 人话 + 秒数', () => {
    expect(cadenceDesc({ everySec: 10 })).toBe('每 10 秒');
    expect(cadenceDesc({ everySec: 300 })).toBe('每 5 分钟');
    expect(cadenceDesc({ everySec: 7200 })).toBe('每 2 小时');
    expect(cadenceDesc({ everySec: 86400 })).toBe('每 1 天');
    expect(cadenceIntervalSec({ everySec: 300 })).toBe(300);
  });
  it('cron+tz → 描述带时区，近似周期：日=86400 / 周=604800 / */N 分钟', () => {
    expect(cadenceDesc({ cron: '30 8 * * *', tz: 'Asia/Shanghai' })).toBe('cron(Asia/Shanghai): 30 8 * * *');
    expect(cadenceIntervalSec({ cron: '30 8 * * *', tz: 'Asia/Shanghai' })).toBe(86400);
    expect(cronApproxIntervalSec('30 5 * * 1')).toBe(7 * 86400);
    expect(cronApproxIntervalSec('*/15 * * * *')).toBe(900);
    expect(cronApproxIntervalSec('0 */4 * * *')).toBe(4 * 3600);
    expect(cronApproxIntervalSec('0 0 1 * *')).toBe(30 * 86400);
    expect(cronApproxIntervalSec('bad')).toBeNull();
  });
  it('没声明 cadence → 空描述/null（不抛），liveness 测试里的裸 job 靠这个兜底', () => {
    expect(cadenceDesc(undefined)).toBe('');
    expect(cadenceIntervalSec(undefined)).toBeNull();
  });
});

describe('最近状态口径', () => {
  it('无记录 / 失败 / 静默 / 正常', () => {
    expect(deriveLastStatus({ hasRecord: false })).toBe('无记录');
    expect(deriveLastStatus({ hasRecord: true, ok: false, liveness: 'ok' })).toBe('失败');
    expect(deriveLastStatus({ hasRecord: true, ok: true, liveness: 'dead' })).toBe('静默');
    expect(deriveLastStatus({ hasRecord: true, ok: true, liveness: 'warn' })).toBe('静默');
    expect(deriveLastStatus({ hasRecord: true, ok: true, liveness: 'ok' })).toBe('正常');
  });
  it('采集腿 last_state/exit_code 映射到同一口径', () => {
    expect(statusFromCollectorState('ok', 0)).toBe('正常');
    expect(statusFromCollectorState('running', null)).toBe('正常');
    expect(statusFromCollectorState('error', null)).toBe('失败');
    expect(statusFromCollectorState('exit 78', 78)).toBe('失败');
    expect(statusFromCollectorState('disabled', null)).toBe('无记录');
    expect(statusFromCollectorState(null, null)).toBe('无记录');
  });
});

describe('Brain job 落总账（upsertBrainJobLedger）', () => {
  const job = { name: 'ci-patrol', cadence: { cron: '0 8 * * *', tz: 'Asia/Shanghai' } };
  const lv = { liveness: 'ok', silent_sec: 30 };

  it('UPSERT 一行 source=brain/host=us-vps/kind=brain_job，登记为 brain-job/registered', async () => {
    const pool = recordingPool(() => ({ rows: [], rowCount: 1 }));
    const wrote = await upsertBrainJobLedger(pool, {
      job, lastRunAt: '2026-10-04T01:00:00.000Z', rec: { ok: true }, lv, collectedAt: '2026-10-04T01:00:30.000Z',
    });
    expect(wrote).toBe(true);
    const q = pool.queries[0];
    expect(q.sql).toContain('INSERT INTO ops_schedule_entries');
    expect(q.sql).toMatch(/ON CONFLICT \(source, host_alias, label\) DO UPDATE/);
    expect(q.sql).toContain("'brain', 'us-vps'");
    expect(q.sql).toContain("'brain-job', 'registered'");
    expect(q.params[0]).toBe('ci-patrol');
    expect(q.params[1]).toBe('cron(Asia/Shanghai): 0 8 * * *');
    expect(q.params[2]).toBe(86400);
    expect(q.params[5]).toBe('正常');
  });

  it('人工列与挂树列永不进 SET（机器每分钟覆盖会冲掉人的结论）', async () => {
    const pool = recordingPool();
    await upsertBrainJobLedger(pool, { job, lastRunAt: null, rec: null, lv: { liveness: 'cold', silent_sec: null }, collectedAt: '2026-10-04T01:00:30.000Z' });
    const setPart = pool.queries[0].sql.split('DO UPDATE SET')[1].split(' WHERE ')[0];
    for (const col of [...MANUAL_COLS, ...TREE_COLS]) expect(assignsCol(setPart, col), col).toBe(false);
  });

  it('降噪：带 WHERE 条件（活性/状态/周期变了或前进≥10min 才写），无变化 rowCount=0 → 返回 false', async () => {
    const pool = recordingPool(() => ({ rows: [], rowCount: 0 }));
    const wrote = await upsertBrainJobLedger(pool, { job, lastRunAt: '2026-10-04T01:00:00.000Z', rec: { ok: true }, lv, collectedAt: '2026-10-04T01:00:30.000Z' });
    expect(wrote).toBe(false);
    const where = pool.queries[0].sql.split(' WHERE ').pop();
    expect(where).toContain("interval '10 minutes'");
    expect(where).toContain('liveness IS DISTINCT FROM');
  });

  it('失败哨兵 → 最近状态=失败；没有任何运行证据 → 无记录', async () => {
    const pool = recordingPool();
    await upsertBrainJobLedger(pool, { job, lastRunAt: '2026-10-04T01:00:00.000Z', rec: { ok: false, error: 'x' }, lv, collectedAt: 'c' });
    expect(pool.queries[0].params[5]).toBe('失败');
    await upsertBrainJobLedger(pool, { job, lastRunAt: null, rec: null, lv: { liveness: 'cold', silent_sec: null }, collectedAt: 'c' });
    expect(pool.queries[1].params[5]).toBe('无记录');
  });

  it('下线的 job 置 inactive，只动 registered_via=brain-job 的行', async () => {
    const pool = recordingPool();
    await deactivateRetiredBrainJobs(pool, ['a', 'b'], 'ts');
    expect(pool.queries[0].sql).toContain("registered_via='brain-job'");
    expect(pool.queries[0].sql).toContain('label <> ALL($1::text[])');
    expect(pool.queries[0].params[0]).toEqual(['a', 'b']);
  });
});

describe('recurring_tasks 落总账（syncRecurringLedger）', () => {
  it('活模板 → brain/local/brain_recurring 行；同名模板加 id 前缀；停用的行置 inactive', async () => {
    const pool = recordingPool((s) => (s.includes('FROM recurring_tasks')
      ? { rows: [
        { id: 'aaaaaaaa-1', title: '日报', cron_expression: '0 9 * * *', last_run_at: '2026-10-03T01:00:00Z', next_run_at: '2026-10-04T01:00:00Z', last_run_status: 'created' },
        { id: 'bbbbbbbb-2', title: '日报', cron_expression: '0 18 * * *', last_run_at: null, next_run_at: null, last_run_status: null },
      ] }
      : { rows: [] }));
    const r = await syncRecurringLedger(pool, new Date('2026-10-04T00:00:00Z'));
    expect(r.templates).toBe(2);
    const ups = pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_schedule_entries'));
    expect(ups).toHaveLength(2);
    expect(ups[0].params[0]).toBe('日报');
    expect(ups[1].params[0]).toBe('日报 #bbbbbbbb');
    expect(ups[0].sql).toContain("'brain', 'local'");
    expect(ups[0].sql).toContain("'recurring', 'registered'");
    expect(ups[0].params[7]).toBe('正常');   // last_status
    expect(ups[1].params[7]).toBe('无记录');
    const off = pool.queries.find((q) => q.sql.startsWith('UPDATE ops_schedule_entries SET active=FALSE'));
    expect(off.params[0]).toEqual(['日报', '日报 #bbbbbbbb']);
    const setPart = ups[0].sql.split('DO UPDATE SET')[1].split(' WHERE ')[0];
    for (const col of [...MANUAL_COLS, ...TREE_COLS]) expect(assignsCol(setPart, col), col).toBe(false);
  });
});

describe('scheduler-liveness 接线总账', () => {
  const NOW = Date.parse('2026-10-04T01:00:00Z');
  const jobs = [
    { name: 'a-job', cadence: { everySec: 60 }, timeoutMs: 1000 },
    { name: 'b-job', cadence: { cron: '0 8 * * *', tz: 'Asia/Shanghai' }, timeoutMs: 1000 },
  ];
  const sentinels = {
    'a-job': { at: new Date(NOW - 5000).toISOString(), ok: true },
    'b-job': { at: new Date(NOW - 5000).toISOString(), ok: true },
  };
  const respond = (s) => {
    if (s.includes('FROM working_memory')) {
      return { rows: Object.entries(sentinels).map(([n, v]) => ({ key: `scheduler_job_last_run:${n}`, value_json: v })) };
    }
    return { rows: [], rowCount: 0 };
  };

  it('每个 job 一行总账 UPSERT + 一次下线清理，且排在 ops_workflows 之后', async () => {
    const pool = recordingPool(respond);
    const r = await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn(), bark: vi.fn() });
    expect(r.ok).toBe(true);
    const sqls = pool.queries.map((q) => q.sql);
    const wfIdx = sqls.findIndex((s) => s.includes('INSERT INTO ops_workflows'));
    const ledgerIdx = sqls.findIndex((s) => s.includes('INSERT INTO ops_schedule_entries'));
    expect(wfIdx).toBeGreaterThanOrEqual(0);
    expect(ledgerIdx).toBeGreaterThan(wfIdx);
    expect(sqls.filter((s) => s.includes('INSERT INTO ops_schedule_entries'))).toHaveLength(2);
    expect(sqls.some((s) => s.startsWith('UPDATE ops_schedule_entries SET active=FALSE'))).toBe(true);
    const b = pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_schedule_entries'))[1];
    expect(b.params[0]).toBe('b-job');
    expect(b.params[1]).toBe('cron(Asia/Shanghai): 0 8 * * *');
  });

  it('总账写入失败（如 517 未迁）只告警一次，liveness 主业不受影响', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = recordingPool((s) => {
      if (s.includes('INSERT INTO ops_schedule_entries')) throw Object.assign(new Error('column "interval_sec" does not exist'), { code: '42703' });
      return respond(s);
    });
    const r = await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn(), bark: vi.fn() });
    expect(r.ok).toBe(true);
    expect(pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_schedule_entries'))).toHaveLength(1); // 首次失败后本轮跳过
    expect(pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows'))).toHaveLength(2);       // ops_workflows 照写
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('总账写入失败'))).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('GET /agent-ops/alarms（buildAlarmsPayload）', () => {
  const rows = [
    { id: 1, source: 'brain', host_alias: 'us-vps', label: 'ci-patrol', kind: 'brain_job', schedule_desc: 'cron(Asia/Shanghai): 0 8 * * *',
      interval_sec: 86400, enabled: true, last_run_at: '2026-10-04T01:00:00Z', last_success_at: '2026-10-04T01:00:00Z', last_status: '正常',
      liveness: 'ok', ledger_status: 'registered', registered_via: 'brain-job', journey_id: 'j-cap', journey_name: '工厂 · F2 部署闭环',
      journey_parent_id: 'j-vs', value_stream_name: '工厂价值流', department_name: '研发与上线部', note: '机器备注', note_manual: '人写的备注', tree_bucket_manual: null },
    { id: 2, source: 'crontab', host_alias: 'mmv', label: 'janitor.sh @ */15 * * * *', kind: 'crontab', schedule_desc: 'cron(UTC): */15 * * * *',
      enabled: true, last_state: null, last_status: null, ledger_status: 'unregistered', registered_via: null, journey_id: null, tree_bucket_manual: null },
    { id: 3, source: 'inventory-20261004', host_alias: 'xian-pc', label: 'old-task', kind: 'win-schtask', schedule_desc: '每天',
      enabled: false, last_state: 'disabled', last_status: '无记录', ledger_status: 'registered', registered_via: 'external-legacy',
      journey_id: null, tree_bucket_manual: '无（淘汰方案）' },
  ];

  it('统一列 + 挂树路径 + 机制归一 + 未登记数 + 来源心跳', async () => {
    const pool = recordingPool((s) => (s.includes('FROM ops_schedule_entries')
      ? { rows }
      : { rows: [{ source: 'crontab', host_alias: 'mmv', source_status: 'ok', last_report_at: '2026-10-04T00:59:00Z', last_collected_at: '2026-10-04T00:59:00Z' }] }));
    const p = await buildAlarmsPayload(pool, new Date('2026-10-04T01:00:00Z'));
    expect(p.alarms).toHaveLength(3);
    const [a, b, c] = p.alarms;
    expect(a).toMatchObject({ name: 'ci-patrol', machine: 'us-vps', mechanism: 'brain-job', enabled: true, last_status: '正常', owner: null });
    expect(a.tree).toMatchObject({ path: '研发与上线部 / 工厂价值流 / F2 部署闭环', department: '研发与上线部', capability: 'F2 部署闭环' });
    expect(a.note).toBe('人写的备注');                       // 人工备注优先于机器备注
    expect(b.tree.path).toBeNull();
    expect(b.last_status).toBe('无记录');                    // 采集腿没写 last_status 时按 last_state 兜底
    expect(c.tree.path).toBe('无（淘汰方案）');              // 树上挂不上时展示暂存文字
    expect(c.enabled).toBe(false);
    expect(p.summary).toMatchObject({ total: 3, enabled: 2, unregistered: 1, without_tree: 1 });
    expect(p.summary.by_mechanism).toMatchObject({ 'brain-job': 1, crontab: 1, 'win-schtask': 1 });
    expect(p.sources[0]).toMatchObject({ source: 'crontab', host_alias: 'mmv', stale: false });
  });

  it('只读 active 行；表/列不存在 → migration_pending（路由层 503，不吐 200 空数组）', async () => {
    const pool = recordingPool(() => { throw Object.assign(new Error('x'), { code: '42703' }); });
    await expect(buildAlarmsPayload(pool)).rejects.toMatchObject({ reason_code: 'migration_pending' });
    const ok = recordingPool(() => ({ rows: [] }));
    await buildAlarmsPayload(ok);
    expect(ok.queries[0].sql).toContain('e.active = TRUE');
  });

  it('机制归一', () => {
    expect(mechanismOf('brain_job')).toBe('brain-job');
    expect(mechanismOf('brain_recurring')).toBe('recurring_tasks');
    expect(mechanismOf('gha_cron')).toBe('gha-schedule');
    expect(mechanismOf('launchd_interval')).toBe('launchd');
    expect(mechanismOf('openclaw_cron')).toBe('openclaw-cron');
    expect(mechanismOf('systemd-timer')).toBe('systemd-timer');
  });
});

describe('迁移 517 形状', () => {
  const sql = readFileSync(join(here, '../../migrations/517_alarm_ledger_columns.sql'), 'utf8');
  const down = readFileSync(join(here, '../../migrations/rollback/517_alarm_ledger_columns.down.sql'), 'utf8');

  it('只给 ops_schedule_entries 加列（不建新表），列齐全且全部 IF NOT EXISTS', () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
    for (const col of ['interval_sec', 'enabled', 'last_run_at', 'last_success_at', 'last_status', 'liveness', 'silent_sec',
      'registered_via', 'ledger_status', 'workflow_id', 'journey_id', 'ops_workflow_id', 'owner_manual', 'note_manual', 'tree_bucket_manual']) {
      expect(sql, col).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
      expect(down, col).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${col}\\b`));
    }
    expect(sql).toContain("VALUES ('517'");
    expect(down).toContain("version = '517'");
  });

  it('回滚先删总账自有行（快照/Brain job/recurring），再删列；挂树外键是 SET NULL', () => {
    expect(down.indexOf('DELETE FROM ops_schedule_entries')).toBeLessThan(down.indexOf('DROP COLUMN'));
    expect(sql).toMatch(/workflow_id UUID REFERENCES workflows\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/journey_id UUID REFERENCES journeys\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/ops_workflow_id BIGINT REFERENCES ops_workflows\(id\) ON DELETE SET NULL/);
  });
});
