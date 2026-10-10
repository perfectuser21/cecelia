/**
 * Migration 546 Tests — decisions_made_by_check 补 'ai'（只增不减）
 *
 * QA T-5：coding-workflow 写判定点（spec-review.mjs 当时用 made_by:'ai'）在从迁移建出的库上撞
 * decisions_made_by_check（迁移 193 只允许 user/cecelia/system）→ 500。
 * 不依赖 DB：读 migration SQL 验证关键内容；真库验证由 strategic-decisions-category-smoke 兜底。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

const sqlPath = new URL('../../migrations/546_decisions_made_by_allow_ai.sql', import.meta.url).pathname;
const callerPath = new URL('../../scripts/coding-workflow/activities/spec-review.mjs', import.meta.url).pathname;

describe('Migration 546 — decisions_made_by_check 补 ai', () => {
  it('迁移文件存在', () => {
    expect(existsSync(sqlPath)).toBe(true);
  });

  const sql = existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : '';

  it('真实调用方 spec-review.mjs 写判定点用的 made_by 落在迁移后的约束取值内', () => {
    // main #6238 已把调用方改成 made_by:'system'；不论 ai 还是 system，迁移后的库都必须收得下
    const madeBy = readFileSync(callerPath, 'utf8').match(/made_by:\s*'([^']+)'/)?.[1];
    const base = sql.match(/ARRAY\[('[^\]]+')\]/)?.[1].match(/'([^']+)'/g).map(s => s.slice(1, -1)) ?? [];
    expect([...base, 'ai']).toContain(madeBy);
  });

  it('读现有 decisions_made_by_check 取值求并集（只增不减）', () => {
    expect(sql).toMatch(/pg_get_constraintdef/);
    expect(sql).toMatch(/conname\s*=\s*'decisions_made_by_check'/);
    expect(sql).toMatch(/regexp_matches/);
    expect(sql).toMatch(/ARRAY\['ai'\]/);
  });

  it('约束不存在时以迁移 193 的取值为底', () => {
    expect(sql).toMatch(/ARRAY\['cecelia',\s*'system',\s*'user'\]/);
  });

  it('重建同名约束，NOT VALID 不扫存量行', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS decisions_made_by_check/);
    expect(sql).toMatch(/ADD CONSTRAINT decisions_made_by_check CHECK \(made_by IN \(%s\)\) NOT VALID/);
  });

  it('单事务 + lock_timeout + 登记 schema_version 546', () => {
    expect(sql).toMatch(/BEGIN;[\s\S]*SET LOCAL lock_timeout[\s\S]*COMMIT;/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'546'[\s\S]*ON CONFLICT \(version\) DO NOTHING/);
  });
});
