import { describe, it, expect } from 'vitest';
import { buildWhereClause } from '../features.js';

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
