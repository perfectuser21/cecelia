/**
 * KR Verifier 区分测试：内容生成 vs 自动发布
 *
 * 验证 migration 209 的语义正确性：
 * - 内容生成 KR 使用 status != 'failed'（产出即算）
 * - 自动发布 KR 使用 status = 'completed'（发布完成才算）
 * - 两者 SQL 查询不相同
 * - OKR API LIMIT 5 已移除，改为 JOIN 过滤
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATION_PATH = resolve(__dirname, '../packages/brain/migrations/209_differentiate_kr_verifier_queries.sql');
const OKR_API_PATH = resolve(__dirname, '../packages/brain/src/routes/okr-hierarchy.js');

describe('Migration 209: KR Verifier 语义区分', () => {
  it('migration 文件存在', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('自动发布 KR 使用 status = completed（只计已成功发布）', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(content).toContain("status = 'completed'");
  });

  it('内容生成 KR 使用 status != failed（产出即计）', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(content).toContain("status != 'failed'");
  });

  it('两个 KR 的 SQL 不相同（区分了产出和发布）', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(content).toContain("status = 'completed'");
    expect(content).toContain("status != 'failed'");
  });

  it('migration 针对正确的 KR ID', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf-8');
    expect(content).toContain('4b4d2262-b250-4e7b-8044-00d02d2925a3');
    expect(content).toContain('65b4142d-242b-457d-abfa-c0c38037f1e9');
  });
});

describe('OKR Hierarchy API: LIMIT 5 已移除', () => {
  it('okr-hierarchy.js 不再包含 LIMIT 5', () => {
    const content = readFileSync(OKR_API_PATH, 'utf-8');
    expect(content).not.toContain('LIMIT 5');
  });

  it('okr-hierarchy.js /current 端点使用 JOIN 过滤只有活跃 KR 的 objectives', () => {
    const content = readFileSync(OKR_API_PATH, 'utf-8');
    expect(content).toContain('JOIN key_results kr ON kr.objective_id = o.id');
    expect(content).toContain("kr.status != 'archived'");
  });
});
