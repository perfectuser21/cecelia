import { describe, it, expect } from 'vitest';
import { stripUnknownProperties, NOTION_PROPERTY_MAP } from './notion-property-map.js';

describe('notion-property-map', () => {
  it('exports NOTION_PROPERTY_MAP object', () => {
    expect(NOTION_PROPERTY_MAP).toBeDefined();
    expect(typeof NOTION_PROPERTY_MAP).toBe('object');
  });

  it('notionTask.allowedKeys does not contain Status (Bug 2 regression guard)', () => {
    const keys = NOTION_PROPERTY_MAP.notionTask?.allowedKeys ?? [];
    expect(keys).not.toContain('Status');
  });

  it('stripUnknownProperties keeps allowed keys', () => {
    const { props, warnings } = stripUnknownProperties(
      { Name: { title: [] }, Status: { select: {} } },
      ['Name'],
    );
    expect(props['Name']).toBeDefined();
    expect(props['Status']).toBeUndefined();
    expect(warnings.some(w => w.includes('Status'))).toBe(true);
  });

  it('stripUnknownProperties returns empty warnings when all keys allowed', () => {
    const { props, warnings } = stripUnknownProperties(
      { Name: { title: [] } },
      ['Name'],
    );
    expect(props['Name']).toBeDefined();
    expect(warnings).toHaveLength(0);
  });
});
