import { describe, it, expect } from 'vitest';
import { buildDesignDocsFilter } from '../design-docs.js';

describe('design-docs route — buildDesignDocsFilter', () => {
  it('returns empty where when no filters', () => {
    const { where, params } = buildDesignDocsFilter({});
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('filters by single type', () => {
    const { where, params } = buildDesignDocsFilter({ type: 'diary' });
    expect(where).toBe('WHERE type = $1');
    expect(params).toEqual(['diary']);
  });

  it('filters by multiple comma-separated types using ANY', () => {
    const { where, params } = buildDesignDocsFilter({ type: 'diary,research' });
    expect(where).toContain('ANY($1)');
    expect(params[0]).toEqual(['diary', 'research']);
  });

  it('filters by area', () => {
    const { where, params } = buildDesignDocsFilter({ area: 'brain' });
    expect(where).toBe('WHERE area = $1');
    expect(params).toEqual(['brain']);
  });

  it('filters by status', () => {
    const { where, params } = buildDesignDocsFilter({ status: 'active' });
    expect(where).toBe('WHERE status = $1');
    expect(params).toEqual(['active']);
  });

  it('combines type and area filters', () => {
    const { where, params } = buildDesignDocsFilter({ type: 'battle_report', area: 'brain' });
    expect(where).toContain('type = $1');
    expect(where).toContain('area = $2');
    expect(params).toEqual(['battle_report', 'brain']);
  });

  it('ignores empty type string', () => {
    const { where, params } = buildDesignDocsFilter({ type: '' });
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('trims whitespace from comma-separated types', () => {
    const { params } = buildDesignDocsFilter({ type: ' diary , research ' });
    expect(params[0]).toEqual(['diary', 'research']);
  });
});
