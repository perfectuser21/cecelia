import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildWhereClause } from '../features.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const featuresSrc = readFileSync(join(__dirname, '../features.js'), 'utf8');

describe('features route — buildWhereClause', () => {
  it('returns empty clause when no filters', () => {
    const { where, params } = buildWhereClause({});
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('filters by priority', () => {
    const { where, params } = buildWhereClause({ priority: 'P0' });
    expect(where).toBe('WHERE priority = $1');
    expect(params).toEqual(['P0']);
  });

  it('handles smoke_cmd null filter', () => {
    const { where, params } = buildWhereClause({ smoke_cmd: 'null' });
    expect(where).toBe('WHERE smoke_cmd IS NULL');
    expect(params).toEqual([]);
  });

  it('combines domain and area filters', () => {
    const { where, params } = buildWhereClause({ domain: 'brain', area: 'health' });
    expect(where).toContain('domain = $1');
    expect(where).toContain('area = $2');
    expect(params).toEqual(['brain', 'health']);
  });
});

describe('features route — SQL 表名迁移验证', () => {
  it('所有 SQL 使用 brain_modules 而非旧名 features', () => {
    expect(featuresSrc).toMatch(/FROM brain_modules/);
    expect(featuresSrc).toMatch(/INTO brain_modules/);
    expect(featuresSrc).toMatch(/UPDATE brain_modules/);
    expect(featuresSrc).not.toMatch(/FROM features\b/);
    expect(featuresSrc).not.toMatch(/INTO features\b/);
    expect(featuresSrc).not.toMatch(/UPDATE features\b/);
  });

  it('导入 computeLedgerStatus 共享函数，不重复实现', () => {
    expect(featuresSrc).toContain("from '../lib/eleven-elements-ledger.js'");
    expect(featuresSrc).not.toContain('function ledgerStatus');
    expect(featuresSrc).not.toContain('function daysSince');
  });
});
