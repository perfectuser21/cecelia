import { describe, it, expect } from 'vitest';

// buildWhereClause 测试不需要 DB mock，单独 import
// computeLedgerStatus 纯函数测试见 lib/__tests__/eleven-elements-ledger.test.js

describe('features route — buildWhereClause', () => {
  it('returns empty clause when no filters', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({});
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('filters by priority', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({ priority: 'P0' });
    expect(where).toBe('WHERE priority = $1');
    expect(params).toEqual(['P0']);
  });

  it('handles smoke_cmd null filter', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({ smoke_cmd: 'null' });
    expect(where).toBe('WHERE smoke_cmd IS NULL');
    expect(params).toEqual([]);
  });

  it('combines domain and area filters', async () => {
    const { buildWhereClause } = await import('../features.js');
    const { where, params } = buildWhereClause({ domain: 'brain', area: 'health' });
    expect(where).toContain('domain = $1');
    expect(where).toContain('area = $2');
    expect(params).toEqual(['brain', 'health']);
  });
});

// 验证 GET /ledger 端点查询的是 brain_modules 表，而非旧的 features 表
// 通过读源码确认（避免 vi.mock hoisting 复杂性，且更直接）
describe('features route — SQL 表名验证', () => {
  it('features.js 源码所有 SQL 使用 brain_modules 而非 features', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '../features.js'), 'utf8');

    // 所有 SQL 关键字后应该跟 brain_modules，不能有 FROM features / INTO features 等
    expect(src).toMatch(/FROM brain_modules/);
    expect(src).toMatch(/INTO brain_modules/);
    expect(src).toMatch(/UPDATE brain_modules/);
    expect(src).not.toMatch(/FROM features\b/);
    expect(src).not.toMatch(/INTO features\b/);
    expect(src).not.toMatch(/UPDATE features\b/);
  });

  it('features.js 导入了 computeLedgerStatus 共享函数', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '../features.js'), 'utf8');
    expect(src).toContain("import { computeLedgerStatus }");
    expect(src).toContain("eleven-elements-ledger");
  });
});
