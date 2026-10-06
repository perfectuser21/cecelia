/**
 * 闹钟总账静态快照导入（任务 fe10d1a0，E.4）：规划（纯函数）、事务执行、数据文件形状。
 * 规则：已采集来源只补挂树列（只补空）；未采集来源插 source=inventory-20261004 静态快照；重跑幂等。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseInventoryTime, parseEnabled, normalizeHost, buildJourneyResolver, matchCollectedRows,
  planInventoryImport, importInventorySnapshot,
} from '../ops-alarm-import.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('盘点静态快照导入（规划）', () => {
  const journeys = [
    { id: 'vs-sys', name: '系统运行保障', parent_journey_id: null, status: 'active' },
    { id: 'cap-clean', name: '系统运行保障 · 清理与容量', parent_journey_id: 'vs-sys', status: 'active' },
    { id: 'vs-acq', name: '客户智能获客路径', parent_journey_id: null, status: 'active' },
    { id: 'cap-kw', name: '关键词获客', parent_journey_id: 'vs-acq', status: 'active' },
    { id: 'vs-fac', name: '工厂价值流', parent_journey_id: null, status: 'active' },
    { id: 'cap-f0', name: '工厂 · F0 提案拍板闭环', parent_journey_id: 'vs-fac', status: 'active' },
    { id: 'vs-gone', name: '已删价值流', parent_journey_id: null, status: 'deleted' },
  ];

  it('时间/启用/主机解析', () => {
    expect(parseInventoryTime('2026-10-04 09:24（推断）')).toBe('2026-10-04T01:24:00.000Z'); // 北京时间
    expect(parseInventoryTime('2026-09-17（最后一次有新内容）')).toBe('2026-09-16T16:00:00.000Z');
    expect(parseInventoryTime('无记录')).toBeNull();
    expect(parseEnabled('启用（Ready）')).toBe(true);
    expect(parseEnabled('禁用（没配置）')).toBe(false);
    expect(parseEnabled('未加载')).toBe(false);
    expect(normalizeHost('hk-vps（zenithjoy-api-prod）')).toBe('hk-vps');
    expect(normalizeHost('MMV')).toBe('mmv');
  });

  it('树解析：精确 → 容错（价值流/能力互相包含且唯一）→ 只挂价值流 → 暂存文字', () => {
    const r = buildJourneyResolver(journeys);
    expect(r('系统运行保障部 / 系统运行保障 / 清理与容量')).toEqual({ journeyId: 'cap-clean', bucket: null });
    expect(r('增长获客部 / 客户智能获客 / 关键词获客')).toEqual({ journeyId: 'cap-kw', bucket: null });
    expect(r('研发与上线部 / 工厂价值流 / F0 提案拍板')).toEqual({ journeyId: 'cap-f0', bucket: null });
    const partial = r('研发与上线部 / 工厂价值流 / 不存在的能力');
    expect(partial.journeyId).toBe('vs-fac');
    expect(partial.bucket).toContain('树上暂无该能力');
    expect(r('个人区（不进公司树）')).toEqual({ journeyId: null, bucket: '个人区（不进公司树）' });
    expect(r('x / 已删价值流 / y').journeyId).toBeNull();     // 软删除的节点不能被挂
    expect(r('管家部 / 管家价值流 / 任务流转（GTD/秋米）').bucket).toBeTruthy(); // 能力名里的 / 不被拆
  });

  it('采集腿匹配：整名 / 前缀+" @" / gha 文件名；对不上如实留在 unmatched', () => {
    const existing = [
      { id: 1, source: 'crontab', host_alias: 'us-vps', label: 'opc-okr-sync.py @ 15 22 * * *' },
      { id: 2, source: 'crontab', host_alias: 'us-vps', label: 'opc-okr-sync.py @ 35 16 * * *' },
      { id: 3, source: 'gha', host_alias: 'github', label: 'zenithjoy/kuaishou-e2e.yml' },
      { id: 4, source: 'crontab', host_alias: 'mmv', label: 'janitor.sh @ */15 * * * *' },
    ];
    const m1 = matchCollectedRows({ name: 'opc-okr-sync.py（5 条 cron 行）' }, { source: 'crontab', host: 'us-vps' }, existing);
    expect(m1.map((r) => r.id)).toEqual([1, 2]);
    const m2 = matchCollectedRows({ name: 'Kuaishou Publisher E2E（kuaishou-e2e.yml）' }, { source: 'gha', host: 'github' }, existing);
    expect(m2.map((r) => r.id)).toEqual([3]);
    expect(matchCollectedRows({ name: 'janitor-daily' }, { source: 'crontab', host: 'mmv' }, existing)).toEqual([]);
  });

  it('规划：采集来源只补挂树（不插行）、未采集来源插静态快照、重名加序号、停用状态保留', () => {
    const existing = [
      { id: 10, source: 'crontab', host_alias: 'mmv', label: 'janitor.sh @ */15 * * * *' },
      { id: 11, source: 'brain', host_alias: 'us-vps', label: 'disk-guard' },
    ];
    const items = [
      { name: 'janitor.sh', host: 'MMV', mech: 'crontab', freq: '每 15 分钟', en: '启用', node: '系统运行保障部 / 系统运行保障 / 清理与容量', last: '无记录', ok: '无记录', st: '无记录', note: '' },
      { name: 'disk-guard', host: 'us-vps', mech: 'brain-job', freq: '15min', en: '启用', node: '系统运行保障部 / 系统运行保障 / 清理与容量', last: '2026-10-04 09:25', ok: '2026-10-04 09:25', st: '正常', note: '' },
      { name: 'nightly-x', host: 'hk-vps', mech: 'systemd-timer', freq: '每天', en: '禁用（没配置）', node: '无（历史残留）', last: '2026-09-01', ok: '无记录', st: '失败', note: '历史残留' },
      { name: 'nightly-x', host: 'hk-vps（n8n 容器）', mech: 'n8n-schedule', freq: '每天', en: '启用', node: '无', last: '无记录', ok: '无记录', st: '怪状态', note: '' },
      { name: 'ghost', host: 'us-vps', mech: 'brain-job', freq: '60s', en: '启用', node: '无', last: '无记录', ok: '无记录', st: '无记录', note: '' },
    ];
    const plan = planInventoryImport(items, journeys, existing);
    expect(plan.tree_updates).toEqual([
      { id: 10, label: 'janitor.sh @ */15 * * * *', source: 'crontab', journey_id: 'cap-clean', bucket: null, baseline: true },
      { id: 11, label: 'disk-guard', source: 'brain', journey_id: 'cap-clean', bucket: null, baseline: false },
    ]);
    expect(plan.unmatched).toEqual([{ name: 'ghost', source: 'brain', host: 'us-vps' }]); // brain job 还没落表 → 如实报，不猜
    expect(plan.inserts).toHaveLength(2);
    const [a, b] = plan.inserts;
    expect(a).toMatchObject({ host_alias: 'hk-vps', label: 'nightly-x', kind: 'systemd-timer', enabled: false, last_state: 'disabled', last_status: '失败', bucket: '无（历史残留）', journey_id: null });
    expect(a.last_run_at).toBe('2026-08-31T16:00:00.000Z');
    expect(b).toMatchObject({ host_alias: 'hk-vps', label: 'nightly-x #2', kind: 'n8n-schedule', enabled: true, last_status: '无记录' });
  });

  it('干跑只读不写；真写走事务，且只补空（COALESCE）、人工列不出现', async () => {
    const calls = [];
    const client = { query: async (sql, p) => { calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), p }); return { rows: [] }; }, release: vi.fn() };
    const pool = {
      query: async (sql) => (String(sql).includes('FROM (SELECT * FROM value_streams') ? { rows: journeys } : { rows: [{ id: 10, source: 'crontab', host_alias: 'mmv', label: 'janitor.sh @ */15 * * * *' }] }),
      connect: async () => client,
    };
    const items = [
      { name: 'janitor.sh', host: 'MMV', mech: 'crontab', freq: '', en: '启用', node: '系统运行保障部 / 系统运行保障 / 清理与容量', last: '', ok: '', st: '', note: '' },
      { name: 'x-timer', host: 'nas', mech: 'systemd-timer', freq: '每天', en: '启用', node: '无', last: '', ok: '', st: '正常', note: 'n' },
    ];
    const dry = await importInventorySnapshot(pool, items, { dryRun: true });
    expect(dry).toMatchObject({ dry_run: true, tree_updates: 1, inserts: 1 });
    expect(calls).toHaveLength(0);

    const done = await importInventorySnapshot(pool, items, { dryRun: false, now: new Date('2026-10-04T02:00:00Z') });
    expect(done).toMatchObject({ dry_run: false, tree_updates: 1, inserts: 1 });
    const sqls = calls.map((c) => c.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    const upd = calls.find((c) => c.sql.startsWith('UPDATE ops_schedule_entries'));
    expect(upd.sql).toContain('COALESCE(journey_id, $2)');
    expect(upd.sql).toContain('COALESCE(tree_bucket_manual, $3)');
    const ins = calls.find((c) => c.sql.startsWith('INSERT INTO ops_schedule_entries'));
    expect(ins.p[0]).toBe('inventory-20261004');
    expect(ins.sql).toContain("'external-legacy','registered'");
    for (const c of calls) { expect(c.sql).not.toContain('owner_manual'); expect(c.sql).not.toContain('note_manual'); }
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('写入中途抛错 → ROLLBACK 并释放连接', async () => {
    const seen = [];
    const client = {
      query: async (sql) => { seen.push(String(sql).trim()); if (String(sql).includes('INSERT')) throw new Error('boom'); return { rows: [] }; },
      release: vi.fn(),
    };
    const pool = { query: async (sql) => ({ rows: String(sql).includes('FROM (SELECT * FROM value_streams') ? journeys : [] }), connect: async () => client };
    const items = [{ name: 'x', host: 'nas', mech: 'systemd-timer', freq: '', en: '启用', node: '无', last: '', ok: '', st: '', note: '' }];
    await expect(importInventorySnapshot(pool, items, { dryRun: false })).rejects.toThrow('boom');
    expect(seen).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('盘点数据文件（scripts/ops/inventory）', () => {
  const items = JSON.parse(readFileSync(join(here, '../../scripts/ops/inventory/alarm-ledger-20261004.json'), 'utf8'));

  it('417 条、字段齐全、状态值在口径内', () => {
    expect(items).toHaveLength(417);
    for (const it of items) {
      for (const k of ['name', 'host', 'mech', 'freq', 'en', 'node', 'last', 'ok', 'st', 'note']) expect(typeof it[k], `${it.name}.${k}`).toBe('string');
      expect(['正常', '失败', '静默', '无记录'], it.name).toContain(it.st);
    }
  });

  it('全量规划不抛：每条要么补挂树、要么插快照、要么如实 unmatched，三者互斥且无遗漏', () => {
    const plan = planInventoryImport(items, [], []);
    // 空库：采集来源全部 unmatched（recurring 例外转快照），其余全是快照行
    const collected = items.filter((i) => ['brain-job', 'openclaw-cron', 'crontab', 'gha-schedule'].includes(i.mech)
      && !(i.mech === 'crontab' && !['MMV', 'us-vps'].includes(i.host))
      && !(i.mech === 'openclaw-cron' && i.host !== 'MMV'));
    expect(plan.tree_updates).toHaveLength(0);
    expect(plan.unmatched).toHaveLength(collected.length);
    expect(plan.inserts).toHaveLength(items.length - collected.length);
    const keys = new Set(plan.inserts.map((r) => `${r.host_alias}|${r.label}`));
    expect(keys.size).toBe(plan.inserts.length); // (host,label) 唯一，否则 ON CONFLICT 会互相覆盖
  });
});
