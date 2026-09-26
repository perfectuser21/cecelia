/**
 * 迁移 474 结构断言（链 bf5088a3 棒2，任务 ddf3fe8d，决策 702949b6）：step_probes 探针注册表。
 * 仓库 YAML 是探针 SSOT，Brain 只存 spec + spec_hash（sha256 canonical JSON），漂移即报。
 * 真库行为见 ../routes/step-probes.test.js（mock pool）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/474_step_probes.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/474_step_probes.down.sql', import.meta.url));

describe('migration 474', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('建 step_probes 表：probe_key UNIQUE、spec/spec_hash NOT NULL、FK journey_step_links 可空', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS step_probes/);
    expect(sql).toMatch(/probe_key text NOT NULL UNIQUE/);
    expect(sql).toMatch(/workflow text NOT NULL/);
    expect(sql).toMatch(/stage text NOT NULL/);
    expect(sql).toMatch(/journey_step_link_id uuid REFERENCES journey_step_links\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/spec jsonb NOT NULL/);
    expect(sql).toMatch(/spec_hash text NOT NULL/);
    expect(sql).toMatch(/source_path text/);
    expect(sql).toMatch(/active boolean NOT NULL DEFAULT true/);
  });

  it('severity / spec_hash 有 CHECK 约束（幂等 DROP+ADD）', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS step_probes_severity_check/);
    expect(sql).toMatch(/CHECK \(severity IN \('warn', 'error'\)\)/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS step_probes_spec_hash_check/);
    expect(sql).toMatch(/CHECK \(spec_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });

  it('按 workflow+stage 与 journey_step_link_id 建索引', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_step_probes_workflow_stage ON step_probes\(workflow, stage\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_step_probes_link ON step_probes\(journey_step_link_id\)/);
  });

  it('登记 schema_version 474', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'474'/);
  });

  it('回滚脚本删表并摘掉 schema_version 记录', () => {
    const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(downSql).toMatch(/DROP TABLE IF EXISTS step_probes/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '474'/);
  });
});
