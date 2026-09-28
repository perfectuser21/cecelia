/**
 * 迁移 481 结构断言（决策 28674999，任务 6227b8c1）：删除 A 类 37 张空表 + 5 个依赖视图。
 * 这些表在 packages/brain、apps/api、scripts 中无任何 SQL 读写；非空闸保护审计后被写入的情况；
 * 刻意不用 CASCADE，清单外依赖会让迁移失败而不是静默连带删除。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/481_drop_empty_tables_class_a.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/481_drop_empty_tables_class_a.down.sql', import.meta.url));
const sql = (existsSync(up) ? readFileSync(up, 'utf8') : '').replace(/^\s*--.*$/gm, ''); // 去注释，只断言可执行语句
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

const TABLES = [
  'acceptance_run', 'acceptance_template', 'check_result', 'device_result', 'voice_call_records',
  'conversations_legacy_pre_359', 'incidents_legacy_pre346',
  'account', 'session', 'user', 'verification',
  'analytics_aggregations', 'events', 'page_views', 'user_sessions', 'event_batches',
  'bottleneck_items', 'bottleneck_reports', 'bottleneck_scans', 'watchdog_bottleneck_records',
  'brain_health_checks', 'code_scan_results', 'failure_events', 'rule_violation_logs', 'policies',
  'snapshots', 'pattern_similarity', 'decision_experiences', 'learning_queue', 'evolution_history',
  'strategies', 'task_quality_checks', 'publish_daily_stats', 'review_environments', 'trds',
  'trd_decomposition_tasks', 'wechat_rpa_sessions',
];
const VIEWS = ['active_sessions', 'event_summary', 'v_evolution_effectiveness_summary', 'v_pending_evolution_evaluations', 'v_recent_rollbacks'];
const dropTableStmt = (sql.match(/DROP TABLE IF EXISTS([\s\S]*?);/) || [])[1] || '';

describe('migration 481', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('A 类 37 张表全部在同一条 DROP TABLE 里，且没有清单外的表', () => {
    expect(TABLES).toHaveLength(37);
    for (const t of TABLES) expect(dropTableStmt).toContain(`public."${t}"`);
    expect(dropTableStmt.match(/public\."/g)).toHaveLength(37);
  });

  it('不用 CASCADE（清单外依赖必须让迁移失败）', () => {
    expect(sql).not.toMatch(/CASCADE/i);
  });

  it('非空闸：表存在且非空即 RAISE EXCEPTION，覆盖全部 37 张', () => {
    expect(sql).toMatch(/to_regclass/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
    const guard = sql.slice(0, sql.indexOf('DROP VIEW'));
    for (const t of TABLES) expect(guard).toContain(`'${t}'`);
  });

  it('先删 5 个依赖视图', () => {
    const dropView = (sql.match(/DROP VIEW IF EXISTS([\s\S]*?);/) || [])[1] || '';
    for (const v of VIEWS) expect(dropView).toContain(`public.${v}`);
    expect(sql.indexOf('DROP VIEW')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });

  it('登记 schema_version 481', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'481'/);
  });

  it('回滚：重建 37 张表 + 5 个视图，删 schema_version 481', () => {
    expect(downSql.match(/^CREATE TABLE /gm)).toHaveLength(37);
    expect(downSql.match(/^CREATE VIEW /gm)).toHaveLength(5);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '481'/);
    expect(downSql).not.toMatch(/set_config\('search_path'/);
  });
});
