/**
 * Migration 266 Tests — mouth.fallbacks 移除失效 codex / anthropic-api
 *
 * 不依赖 DB（避免 CI flaky），通过读取 migration SQL 文件验证关键内容。
 * 实际 DB 验证由 brain-integration test 兜底（启动时 apply 所有 migrations）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Migration 266 — mouth fallbacks OAuth-only', () => {
  const sqlPath = new URL('../../migrations/266_mouth_fallback_oauth_only.sql', import.meta.url).pathname;
  const sql = readFileSync(sqlPath, 'utf8');

  it('UPDATE 语句目标 model_profiles', () => {
    expect(sql).toMatch(/UPDATE\s+model_profiles/i);
  });

  it('用 jsonb_set 改 mouth.fallbacks 路径', () => {
    expect(sql).toMatch(/jsonb_set\s*\(\s*config\s*,\s*'\{mouth,fallbacks\}'/);
  });

  it('新 fallback 是 anthropic provider haiku 模型（OAuth bridge）', () => {
    expect(sql).toContain('"provider":"anthropic"');
    expect(sql).toContain('"model":"claude-haiku-4-5-20251001"');
  });

  it('WHERE 子句精确匹配含 codex 或 anthropic-api 的 profile', () => {
    expect(sql).toMatch(/codex/);
    expect(sql).toMatch(/anthropic-api/);
    expect(sql).toMatch(/@>/);
  });

  it('migration 不操作其他 agent 配置（UPDATE 路径只针对 mouth.fallbacks）', () => {
    // 注释里允许提到其他 agent（说明用），但 UPDATE 子句不能改它们
    const updateBlock = sql.match(/UPDATE[\s\S]+?(?=\n\n|$)/i)?.[0] || '';
    expect(updateBlock).not.toMatch(/cortex,fallbacks/i);
    expect(updateBlock).not.toMatch(/reflection,fallbacks/i);
    expect(updateBlock).not.toMatch(/rumination,fallbacks/i);
    // jsonb_set 路径只能是 mouth
    expect(updateBlock).toMatch(/'\{mouth,fallbacks\}'/);
  });

  it('SQL 含背景注释解释为什么改', () => {
    expect(sql).toMatch(/refresh token 失效|信用余额|cecelia-run 熔断/);
  });
});
