/**
 * 迁移 519 结构断言（框架标准 v2.0 · 流程层登记，任务 6741b288）：
 * 旧树 journey_features 里的 ability（能力×平台/渠道）其实就是标准里的「流程（workflow）」，
 * 本迁移把它们登记进 workflows（挂到 部门→价值流→能力 下），为每个有闹钟的能力补默认流程，
 * 并把闹钟总账 ops_schedule_entries.workflow_id 回填；旧树只标 deprecated 不删。
 * CI 用空库跑全量迁移，所以所有 INSERT 必须守卫（能力不存在就跳过），不能裸 VALUES。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/519_workflow_layer_registration.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/519_workflow_layer_registration.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

// workflows.key 合法形状（494 定下：小写字母开头，只许 a-z 0-9 _ . -）
const KEY_RE = /^[a-z][a-z0-9_.-]{0,99}$/;

// 有闹钟但没有流程的能力 → 默认定时作业流程（key）
const DEFAULT_OPS = [
  'content_calendar_ops', 'factory_f0_ops', 'factory_f1_ops', 'factory_f2_ops', 'factory_f3_ops', 'factory_f4_ops',
  'factory_mj5_ops', 'skill_lifecycle_ops', 'customer_first_success_ops', 'publish_account_session_ops',
  'butler_g1_cockpit_ops', 'butler_g2_inbox_ops', 'butler_g4_memory_ops', 'okr_kr_sync_ops',
  'infra_distribution_sync_ops', 'infra_backup_restore_ops', 'infra_runner_pool_ops', 'infra_data_projection_ops',
  'infra_cleanup_capacity_ops', 'infra_monitoring_alerting_ops', 'infra_network_ingress_ops',
  'infra_device_phone_ledger_ops', 'infra_account_credentials_ops',
  'biz_rhythm_meetings_ops', 'biz_object_ledger_ops', 'biz_broadcast_ops',
];

const section = (name) => {
  const m = sql.match(new RegExp(`-- ===+ ${name}[\\s\\S]*?(?=\\n-- ===+ |\\nINSERT INTO schema_version)`));
  return m ? m[0] : '';
};

describe('migration 519 — 流程层登记：旧 ability → workflows，闹钟回填 workflow_id', () => {
  it('workflows 加 legacy_feature_id 溯源列（指向 journey_features，删旧行只置空）', () => {
    expect(sql).toMatch(/ALTER TABLE workflows ADD COLUMN IF NOT EXISTS legacy_feature_id uuid[^;]*REFERENCES journey_features\(id\) ON DELETE SET NULL/);
    expect(downSql).toMatch(/ALTER TABLE workflows DROP COLUMN IF EXISTS legacy_feature_id/);
  });

  it('所有 INSERT INTO workflows 都走 FROM (VALUES …) + 能力存在守卫 + ON CONFLICT (key) DO NOTHING，没有裸 VALUES', () => {
    const inserts = sql.match(/INSERT INTO workflows[\s\S]*?;/g) || [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const stmt of inserts) {
      expect(stmt).toMatch(/FROM \(VALUES/);
      expect(stmt).toMatch(/WHERE EXISTS \(SELECT 1 FROM journeys j WHERE j\.id = v\.capability_id(::uuid)? AND j\.parent_journey_id IS NOT NULL\)/);
      expect(stmt).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    }
    expect(sql).not.toMatch(/INSERT INTO workflows\s*\([^)]*\)\s*VALUES/);
  });

  it('新流程 key 形状合法且全文件唯一', () => {
    const inserts = (sql.match(/INSERT INTO workflows[\s\S]*?;/g) || []).join('\n');
    const keys = [...inserts.matchAll(/^\s*\('([^']*)',/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(KEY_RE);
  });

  it('为每个有闹钟但没流程的能力建默认定时作业流程；关键词获客复用既有 douyin_keyword_leadgen 不新建', () => {
    const inserts = (sql.match(/INSERT INTO workflows[\s\S]*?;/g) || []).join('\n');
    for (const key of DEFAULT_OPS) expect(inserts, key).toContain(`'${key}'`);
    expect(inserts).not.toContain('a1000000-0000-4000-8000-000000000001');
    expect(inserts).not.toContain('douyin_keyword_leadgen');
    expect(sql).toMatch(/\('douyin_keyword_leadgen',\s*'a1000000-0000-4000-8000-000000000001'\)/);
  });

  it('闹钟按能力→流程回填 workflow_id，只填空值', () => {
    expect(sql).toMatch(/UPDATE ops_schedule_entries e\s+SET workflow_id = w\.id[\s\S]*?JOIN workflows w ON w\.key = m\.key[\s\S]*?WHERE e\.journey_id = m\.capability_id(::uuid)?\s+AND e\.workflow_id IS NULL/);
  });

  it('旧树只标 deprecated 不删，已退役不重复修改', () => {
    expect(sql).not.toMatch(/DELETE FROM journey_features/);
    expect(sql).not.toMatch(/DELETE FROM journeys/);
    const dep = section('journey_features 退役');
    expect(dep).toMatch(/SET status = 'deprecated'/);
    expect(dep).toMatch(/name LIKE '\[smoke\]%'/);
    expect(dep).toMatch(/name LIKE 'gp-agg-smoke%'/);
    expect(dep).toMatch(/name LIKE 'e2e-%'/);
    expect(dep).toMatch(/status <> 'deprecated'/);
  });

  it('重复能力仅在其下没有流程/闹钟/activity 时退役', () => {
    const cap = section('重复能力退役');
    expect(cap).toMatch(/UPDATE journeys SET status = 'deprecated'/);
    expect(cap).toMatch(/NOT EXISTS \(SELECT 1 FROM workflows/);
    expect(cap).toMatch(/NOT EXISTS \(SELECT 1 FROM ops_schedule_entries/);
    expect(cap).toMatch(/NOT EXISTS \(SELECT 1 FROM journey_steps/);
  });

  it('改前先把 journey_features / journeys / ops_schedule_entries 原值存进 migration_519_backup，回滚按备份还原并删表', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS migration_519_backup/);
    for (const t of ['journey_features', 'journeys', 'ops_schedule_entries']) {
      expect(sql, t).toMatch(new RegExp(`INSERT INTO migration_519_backup[\\s\\S]*?'${t}'`));
      expect(downSql, t).toMatch(new RegExp(`UPDATE ${t}[\\s\\S]*?FROM migration_519_backup b[\\s\\S]*?b\\.table_name = '${t}'`));
    }
    expect(downSql).toMatch(/DELETE FROM workflows WHERE legacy_feature_id IS NOT NULL OR key IN \(/);
    for (const key of DEFAULT_OPS) expect(downSql, key).toContain(`'${key}'`);
    expect(downSql).not.toContain(`'douyin_keyword_leadgen'`);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS migration_519_backup/);
  });

  it('迁移与回滚都在事务里', () => {
    expect(sql.trim().startsWith('--') || sql.trim().startsWith('BEGIN')).toBe(true);
    expect(sql).toMatch(/\nBEGIN;/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(downSql.trim().endsWith('COMMIT;')).toBe(true);
  });
});
