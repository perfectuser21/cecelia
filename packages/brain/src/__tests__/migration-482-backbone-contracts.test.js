/**
 * 迁移 482 结构断言（决策 0834e2fb 契约真身在 git + 92f6226b 获客主干活动以 8 个为准，任务 2fdd5f12）。
 * 真库行为见 activity-contract-sync.test.js（mock pool）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/482_backbone_activity_contracts.sql', import.meta.url));

describe('migration 482', () => {
  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('journey_steps 加契约副本列 + 记账列 notion_digest + (journey_id, activity_key) 部分唯一', () => {
    for (const col of ['capability_key text', 'activity_key text', 'contract jsonb', 'contract_sha256 text', 'contract_source text', 'notion_digest text']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS ${col}`));
    }
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_journey_steps_activity ON journey_steps\s*\(journey_id, activity_key\)\s*WHERE activity_key IS NOT NULL/);
  });

  it('获客 journey 缺失时整段跳过（测试库/新库安全），已有 activity 行时不重复种（幂等）', () => {
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM journeys WHERE id = j\) THEN\s*RETURN/);
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM journey_steps WHERE journey_id = j AND activity_key IS NOT NULL\) THEN\s*RETURN/);
  });

  it('v2.0 四个承诺步骤挪号到 200+ 并 deprecated（不删，保留历史）', () => {
    expect(sql).toMatch(/SET step_number = step_number \+ 200, status = 'deprecated'/);
    expect(sql).not.toMatch(/DELETE FROM journey_steps/);
  });

  it('stage 格子改挂到同名活动', () => {
    expect(sql).toMatch(/UPDATE journey_step_links l\s+SET step_id = s\.id, step_order = s\.step_number[\s\S]*l\.cell_key = 'stage:' \|\| s\.activity_key/);
  });

  it('映射表：Backbone Activities 登记为 journey_steps 的镜子（push/active），旧 unmapped 行归档', () => {
    expect(sql).toMatch(/'mirror', 'journey_steps', 'push'/);
    expect(sql).toMatch(/status = 'archived'[\s\S]*notion_db_id = 'unmapped:backbone_activities'/);
  });
});
