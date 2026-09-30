/**
 * 迁移 495 结构断言（价值流建模④，任务 ec643d60，决策 3e867cad 第 9-10 张表 / 词表 f425e3fd）。
 * 真库行为（CHECK / 幂等键 / 视图算 fallback_rate / 回滚）见 integration/migration-495-vs-model-spans.pg.integration.test.js。
 * 本文件还守住"POST/GET /api/brain/spans 已挂到 server.js"这条接线。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/495_vs_model_spans.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/495_vs_model_spans.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const rb = existsSync(down) ? readFileSync(down, 'utf8') : '';
const server = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');

describe('migration 495 价值流建模④：spans 表 + task_runs.workflow_id + activity_flow_metrics 视图', () => {
  it('文件存在（含回滚）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('spans 表：run_id 必填，四个外键可空，started_at 必填，duration_ms 生成列', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS spans \(/);
    expect(sql).toMatch(/run_id text NOT NULL/);
    expect(sql).toMatch(/workflow_id uuid NULL REFERENCES workflows\(id\)/);
    expect(sql).toMatch(/activity_id uuid NULL REFERENCES journey_steps\(id\)/);
    expect(sql).toMatch(/step_id uuid NULL REFERENCES steps\(id\)/);
    expect(sql).toMatch(/enabler_id uuid NULL REFERENCES enablers\(id\)/);
    expect(sql).toMatch(/started_at timestamptz NOT NULL/);
    expect(sql).toMatch(/duration_ms integer GENERATED ALWAYS AS/);
  });

  it('CHECK：executor_kind code|agent|human、outcome pass|fail|skipped|unknown、至少挂一个目标', () => {
    expect(sql).toMatch(/spans_executor_kind_check CHECK \(executor_kind IN \('code', ?'agent', ?'human'\)\)/);
    expect(sql).toMatch(/spans_outcome_check CHECK \(outcome IN \('pass', ?'fail', ?'skipped', ?'unknown'\)\)/);
    expect(sql).toMatch(/spans_target_check CHECK \(activity_id IS NOT NULL OR step_id IS NOT NULL OR enabler_id IS NOT NULL\)/);
  });

  it('索引：run_id、(activity_id, started_at)、(step_id, started_at)；幂等唯一键 (run_id, coalesce 目标, started_at)', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_spans_run ON spans \(run_id\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_spans_activity_started ON spans \(activity_id, started_at\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_spans_step_started ON spans \(step_id, started_at\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_spans_idem ON spans \(run_id, \(COALESCE\(step_id, activity_id, enabler_id\)\), started_at\)/);
  });

  it('task_runs 加 workflow_id（不回填）', () => {
    expect(sql).toMatch(/ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS workflow_id uuid NULL REFERENCES workflows\(id\)/);
  });

  it('activity_flow_metrics 视图：近 7 天按 activity_id 算 runs / p50 / p95 / fallback_rate / first_pass_yield', () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW activity_flow_metrics AS/);
    expect(sql).toMatch(/percentile_cont\(0\.5\)/);
    expect(sql).toMatch(/percentile_cont\(0\.95\)/);
    expect(sql).toMatch(/fallback_rate/);
    expect(sql).toMatch(/first_pass_yield/);
    expect(sql).toMatch(/interval '7 days'/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'495'/);
  });

  it('回滚：删视图、删 task_runs.workflow_id、删索引/表、删 schema_version', () => {
    expect(rb).toMatch(/DROP VIEW IF EXISTS activity_flow_metrics/);
    expect(rb).toMatch(/ALTER TABLE task_runs DROP COLUMN IF EXISTS workflow_id/);
    expect(rb).toMatch(/DROP INDEX IF EXISTS uq_spans_idem/);
    expect(rb).toMatch(/DROP TABLE IF EXISTS spans/);
    expect(rb).toMatch(/DELETE FROM schema_version WHERE version = '495'/);
  });

  it('接线：server.js 挂载 spansRouter（POST/GET /api/brain/spans）', () => {
    expect(server).toMatch(/import spansRouter from '\.\/src\/routes\/spans\.js'/);
    expect(server).toMatch(/app\.use\('\/api\/brain', spansRouter\)/);
  });
});
