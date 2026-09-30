/**
 * 迁移 496 结构断言（价值流建模⑤，任务 741cdf5a，决策 3e867cad 第 11/13 张表 / 词表 f425e3fd）。
 * 真库行为（target 回填 / coll_rescan_rate 挂 step / step·enabler 级格子生成 / 幂等 / 回滚）见
 * integration/migration-496-probe-targets-cells.pg.integration.test.js。
 * 本文件还守住接线：探针规范认 target、路由持久化 target、sync 脚本解析 target、steps/enablers 只读路由挂到 server.js。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/496_probe_targets_cells_levels.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/496_probe_targets_cells_levels.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('migration 496 价值流建模⑤：探针挂点 target + 格子扩到 step/enabler 级', () => {
  it('文件存在（含回滚）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('step_probes 加 target_type（activity|step|enabler）+ target_id，journey_step_link_id 保留', () => {
    expect(sql).toMatch(/ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS target_type text/);
    expect(sql).toMatch(/ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS target_id uuid/);
    expect(sql).toMatch(/target_type IS NULL OR target_type IN \('activity', ?'step', ?'enabler'\)/);
    expect(sql).not.toMatch(/DROP COLUMN[^;]*journey_step_link_id/);
  });

  it('回填：既有探针 target_type=activity、target_id=格子的 step_id；coll_rescan_rate 改挂 step return_to_results', () => {
    expect(sql).toMatch(/UPDATE step_probes[\s\S]*target_type = 'activity'[\s\S]*journey_step_links/);
    expect(sql).toMatch(/keyword_acquisition\.collection\.return_to_results/);
    expect(sql).toMatch(/probe_key = 'coll_rescan_rate'/);
  });

  it('journey_step_links 加 cell_level（默认 activity）/ step_id_ref → steps / enabler_id → enablers', () => {
    expect(sql).toMatch(/ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_level text NOT NULL DEFAULT 'activity'/);
    expect(sql).toMatch(/cell_level IN \('activity', ?'step', ?'enabler'\)/);
    expect(sql).toMatch(/ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS step_id_ref uuid NULL REFERENCES steps\(id\)/);
    expect(sql).toMatch(/ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS enabler_id uuid NULL REFERENCES enablers\(id\)/);
  });

  it('生成 step 级格子（step:<key>）与 enabler 级格子（enabler:<key>），幂等 ON CONFLICT 不覆盖颜色', () => {
    expect(sql).toMatch(/'step:' \|\| s\.key/);
    expect(sql).toMatch(/'enabler:' \|\| e\.key/);
    expect(sql).toMatch(/ON CONFLICT \(step_id, cell_kind, cell_key\) WHERE cell_kind IS NOT NULL DO NOTHING/);
  });

  it('golden_path* 不 DROP（74 处活引用），只标注退役计划', () => {
    expect(sql).not.toMatch(/DROP TABLE[^;]*golden_path/);
    expect(sql).not.toMatch(/RENAME TO golden_path\w*_legacy/);
    expect(sql).toMatch(/'golden_path', 'golden_paths', 'golden_path_contract_versions'/);
    expect(sql).toMatch(/COMMENT ON TABLE %I IS %L/);
    expect(sql).toMatch(/退役/);
  });

  it('登记 schema_version 496；回滚删生成的格子、删列、删注册', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'496'/);
    const d = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(d).toMatch(/DELETE FROM journey_step_links WHERE cell_level IN \('step', ?'enabler'\)/);
    expect(d).toMatch(/DROP COLUMN IF EXISTS step_id_ref/);
    expect(d).toMatch(/DROP COLUMN IF EXISTS enabler_id/);
    expect(d).toMatch(/DROP COLUMN IF EXISTS cell_level/);
    expect(d).toMatch(/DROP COLUMN IF EXISTS target_id/);
    expect(d).toMatch(/DROP COLUMN IF EXISTS target_type/);
    expect(d).toMatch(/DELETE FROM schema_version WHERE version = '496'/);
  });

  it('接线：spec 认 target、路由持久化 target_type/target_id、sync 解析 target、steps/enablers 路由挂到 server.js', () => {
    expect(src('../lib/step-probe-spec.js')).toMatch(/TARGET_TYPES/);
    expect(src('../routes/step-probes.js')).toMatch(/target_type/);
    expect(src('../../../../scripts/sync-step-probes.mjs')).toMatch(/target_type/);
    const server = src('../../server.js');
    expect(server).toMatch(/import stepsRouter from '\.\/src\/routes\/steps\.js'/);
    expect(server).toMatch(/app\.use\('\/api\/brain', stepsRouter\)/);
  });
});
