/**
 * 迁移 491 结构断言（Skill 台账投影 PR1a，任务 47def5bb，决策 19391396/4b1da4ca）。
 * 真库行为（改名/固定派发命令/注册表改面/幂等）见 integration/migration-491-skill-registry-ledger.integration.test.js。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/491_skill_registry_ledger_columns.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/491_skill_registry_ledger_columns.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

describe('migration 491 skill_registry 台账列', () => {
  it('文件存在（含回滚）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('加齐机器列 / 人管列 / 系统列，一律 ADD COLUMN IF NOT EXISTS', () => {
    const cols = ['platforms_installed', 'presence', 'absent_since', 'last_seen_at', 'last_scanned_at', 'source_path',
      'source_kind', 'assigned_agents', 'content_md', 'content_digest', 'copies', 'drift_copies', 'files', 'tier_suggested',
      'platforms_target', 'openclaw_tier', 'business_line', 'owner', 'category', 'note',
      'notion_baseline', 'notion_push_attempts', 'notion_next_retry_at'];
    for (const c of cols) expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c} `));
  });

  it('eval_score 不建数值列（生产为自由文本，转换会炸迁移）', () => {
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS eval_score/);
    expect(sql).not.toMatch(/::numeric/);
  });

  it('presence / tier 有 CHECK', () => {
    expect(sql).toMatch(/presence IN \('unknown','present','broken','gone'\)/);
    expect(sql).toMatch(/openclaw_tier IN \('A','B','C'\)/);
    expect(sql).toMatch(/tier_suggested IN \('A','B','C'\)/);
  });

  it('先固定带前缀派发行的 dispatch_command，再就地去前缀且避开撞名', () => {
    const pin = sql.indexOf("dispatch_command = '/' || name");
    const rename = sql.indexOf('substring(r.name from 10)');
    expect(pin).toBeGreaterThan(-1);
    expect(rename).toBeGreaterThan(pin);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM skill_registry x WHERE x\.name = substring\(r\.name from 10\)\)/);
    expect(sql).toMatch(/'renamed_from'/);
  });

  it('投影注册表 Skill Registry 改入口面 both', () => {
    expect(sql).toMatch(/UPDATE notion_projection_map[\s\S]*face = 'inlet'[\s\S]*direction = 'both'[\s\S]*353c40c2-ba63-81bf-ae3e-f0e6fa3753d7/);
  });

  it('登记 schema_version 491；回滚删列并还原注册表与名字', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'491'/);
    const d = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(d).toMatch(/DROP COLUMN IF EXISTS notion_baseline/);
    expect(d).toMatch(/face = 'mirror'/);
    expect(d).toMatch(/renamed_from/);
    expect(d).toMatch(/DELETE FROM schema_version WHERE version = '491'/);
  });
});
