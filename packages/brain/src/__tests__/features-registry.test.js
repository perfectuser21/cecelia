import { describe, it, expect } from 'vitest';

// 测试 WHERE 子句构建逻辑（纯函数，从 route 里提取）
import { buildWhereClause } from '../routes/features.js';

describe('buildWhereClause', () => {
  it('returns empty string when no filters', () => {
    const { where, params } = buildWhereClause({});
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('builds priority filter', () => {
    const { where, params } = buildWhereClause({ priority: 'P0' });
    expect(where).toBe('WHERE priority = $1');
    expect(params).toEqual(['P0']);
  });

  it('builds smoke_cmd IS NULL filter', () => {
    const { where, params } = buildWhereClause({ smoke_cmd: 'null' });
    expect(where).toBe('WHERE smoke_cmd IS NULL');
    expect(params).toEqual([]);
  });

  it('combines multiple filters with AND', () => {
    const { where, params } = buildWhereClause({ priority: 'P0', status: 'active' });
    expect(where).toContain('priority = $1');
    expect(where).toContain('status = $2');
    expect(where).toContain('AND');
    expect(params).toEqual(['P0', 'active']);
  });

  it('combines smoke_cmd IS NULL with other filters', () => {
    const { where, params } = buildWhereClause({ priority: 'P1', smoke_cmd: 'null' });
    expect(where).toContain('priority = $1');
    expect(where).toContain('smoke_cmd IS NULL');
    expect(params).toEqual(['P1']);
  });
});
