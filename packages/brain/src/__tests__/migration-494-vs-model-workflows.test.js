/**
 * 迁移 494 结构断言（价值流建模③，任务 ce41cd59，决策 3e867cad 第 4-5 张表 / 752b7166 / 词表 f425e3fd）。
 * 真库行为（守卫触发器 / 回填 / 视图新列 / 回滚）见 integration/migration-494-vs-model-workflows.pg.integration.test.js。
 * 本文件还守住"GET /api/brain/workflows 已挂到 server.js"这条接线。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/494_vs_model_workflows.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/494_vs_model_workflows.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const rb = existsSync(down) ? readFileSync(down, 'utf8') : '';
const server = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');

describe('migration 494 价值流建模③：workflows 表 + backbone activity 挂 workflow/executor/enabler', () => {
  it('文件存在（含回滚）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('workflows 表：capability_id → journeys、key 唯一、status CHECK', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS workflows \(/);
    expect(sql).toMatch(/capability_id uuid NOT NULL REFERENCES journeys\(id\)/);
    expect(sql).toMatch(/key text NOT NULL UNIQUE/);
    expect(sql).toMatch(/workflows_status_check CHECK \(status IN \('active', ?'paused', ?'retired'\)\)/);
  });

  it('capability 守卫：触发器拒绝指向无父 journey（value_stream）的 capability_id', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION workflows_capability_guard\(\)/);
    expect(sql).toMatch(/parent_journey_id IS NOT NULL/);
    expect(sql).toMatch(/CREATE TRIGGER trg_workflows_capability_guard BEFORE INSERT OR UPDATE OF capability_id ON workflows/);
  });

  it('journey_steps 加 workflow_id / executor_kind(code|agent|human) / enabler_id，都可空、不删 journey_id', () => {
    expect(sql).toMatch(/ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS workflow_id uuid NULL REFERENCES workflows\(id\)/);
    expect(sql).toMatch(/ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS executor_kind text NULL/);
    expect(sql).toMatch(/executor_kind IS NULL OR executor_kind IN \('code', ?'agent', ?'human'\)/);
    expect(sql).toMatch(/ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS enabler_id uuid NULL REFERENCES enablers\(id\)/);
    expect(sql).not.toMatch(/DROP COLUMN[^;]*journey_id/);
  });

  it('backbone_activities 视图重建并带出 capability_key/activity_key/workflow_id/executor_kind/enabler_id', () => {
    expect(sql).toMatch(/CREATE VIEW backbone_activities AS SELECT[^;]*workflow_id, executor_kind, enabler_id FROM journey_steps/);
    expect(sql).toMatch(/CREATE VIEW backbone_activities AS SELECT[^;]*capability_key, activity_key/);
  });

  it('ops_workflows 加 workflow_id（n8n 画布降为 Workflow 的运行时实现，决策 752b7166）', () => {
    expect(sql).toMatch(/ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS workflow_id uuid NULL REFERENCES workflows\(id\)/);
  });

  it('回填幂等：两条 capability（关键词获客/对标获客）+ 两条 workflow + 8 activity 挂抖音·关键词获客 + executor_kind + preflight/cleanup enabler', () => {
    expect(sql).toMatch(/'关键词获客'/);
    expect(sql).toMatch(/'对标获客'/);
    expect(sql).toMatch(/'douyin_keyword_leadgen'/);
    expect(sql).toMatch(/'douyin_benchmark_leadgen'/);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    expect(sql).toMatch(/WHEN 'qualification' THEN 'agent'/);
    expect(sql).toMatch(/WHEN 'scoring' THEN 'agent'/);
    expect(sql).toMatch(/'device_lock'/);
    expect(sql).toMatch(/'account_selfcheck'/);
    expect(sql).toMatch(/activity_key IN \('preflight', ?'cleanup'\)/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'494'/);
  });

  it('回滚：删种子 enabler、还原 12 列视图、删三列、删 ops_workflows.workflow_id、删触发器/函数/表、删种子 capability、删 schema_version', () => {
    expect(rb).toMatch(/DELETE FROM enablers WHERE key IN \('device_lock', ?'account_selfcheck'\)/);
    expect(rb).toMatch(/DROP VIEW IF EXISTS backbone_activities/);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS enabler_id/);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS executor_kind/);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS workflow_id/);
    expect(rb).toMatch(/CREATE VIEW backbone_activities AS SELECT id, notion_id, journey_id, name, description, step_number, status, notion_synced_at, created_at, updated_at, promise, backbone_version FROM journey_steps/);
    expect(rb).toMatch(/ALTER TABLE ops_workflows DROP COLUMN IF EXISTS workflow_id/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS workflows_capability_guard\(\)/);
    expect(rb).toMatch(/DROP TABLE IF EXISTS workflows/);
    expect(rb).toMatch(/DELETE FROM schema_version WHERE version = '494'/);
  });

  it('接线：server.js 挂载 GET /api/brain/workflows', () => {
    expect(server).toMatch(/import workflowsRouter from '\.\/src\/routes\/workflows\.js'/);
    expect(server).toMatch(/app\.use\('\/api\/brain', workflowsRouter\)/);
  });
});
