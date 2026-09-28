/**
 * 迁移 482 结构断言（决策 0834e2fb 契约真身在 git + 92f6226b 获客主干活动以 8 个为准，任务 2fdd5f12）。
 * 真库行为见 activity-contract-sync.test.js（mock pool）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/482_backbone_activity_contracts.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/482_backbone_activity_contracts.down.sql', import.meta.url));
const ACTIVITIES = ['preflight', 'discovery', 'qualification', 'collection', 'scoring', 'delivery', 'outreach', 'cleanup'];

describe('migration 482', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('journey_steps 加契约副本列 + 记账列 notion_digest + (journey_id, activity_key) 部分唯一', () => {
    for (const col of ['capability_key text', 'activity_key text', 'contract jsonb', 'contract_sha256 text', 'contract_source text', 'notion_digest text']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS ${col}`));
    }
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_journey_steps_activity ON journey_steps\s*\(journey_id, activity_key\)\s*WHERE activity_key IS NOT NULL/);
  });

  it('获客 journey 缺失时整段跳过（测试库/新库安全），已有 activity 行时不重复种（幂等）', () => {
    expect(sql).toMatch(/afa6abca-53c0-4815-8594-b7fb81ca547f/);
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM journeys WHERE id = j\) THEN\s*RETURN/);
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM journey_steps WHERE journey_id = j AND activity_key IS NOT NULL\) THEN\s*RETURN/);
  });

  it('v2.0 四个承诺步骤挪号到 200+ 并 deprecated（不删，保留历史）', () => {
    expect(sql).toMatch(/SET step_number = step_number \+ 200, status = 'deprecated'/);
    expect(sql).not.toMatch(/DELETE FROM journey_steps/);
  });

  it('种 8 个 v3.0 主干活动（设计顺序），4 个承诺并入预检/判定/评分/触达', () => {
    ACTIVITIES.forEach((k, i) => expect(sql).toMatch(new RegExp(`\\(j, '[^']+', ${i + 1}, 'planned', '3\\.0', 'keyword_acquisition', '${k}'`)));
    for (const [k, n] of [['preflight', 1], ['qualification', 2], ['scoring', 3], ['outreach', 4]]) {
      expect(sql).toMatch(new RegExp(`'${k}', \\(SELECT promise FROM _promises WHERE step_number = ${n}\\)`));
    }
  });

  it('stage 格子改挂到同名活动 + 补 stage:outreach 格子', () => {
    expect(sql).toMatch(/UPDATE journey_step_links l\s+SET step_id = s\.id, step_order = s\.step_number[\s\S]*l\.cell_key = 'stage:' \|\| s\.activity_key/);
    expect(sql).toMatch(/'element', 'stage:outreach', 'gray'/);
  });

  it('映射表：Backbone Activities 登记为 journey_steps 的镜子（push/active），旧 unmapped 行归档', () => {
    expect(sql).toMatch(/'c213e387-b2ae-45a4-98c0-4a66fe3408be', 'Backbone Activities', 'mirror', 'journey_steps', 'push'/);
    expect(sql).toMatch(/status = 'archived'[\s\S]*notion_db_id = 'unmapped:backbone_activities'/);
  });

  it('记 schema_version 482', () => {
    expect(sql).toMatch(/INSERT INTO schema_version \(version, description\)\s*VALUES \('482'/);
  });
});
