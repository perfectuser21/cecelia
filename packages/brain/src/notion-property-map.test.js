import { describe, it, expect } from 'vitest';
import { NOTION_PROPERTY_MAP, stripUnknownProperties } from './notion-property-map.js';

describe('notion-property-map', () => {
  it('exports NOTION_PROPERTY_MAP object', () => {
    expect(typeof NOTION_PROPERTY_MAP).toBe('object');
    expect(NOTION_PROPERTY_MAP).not.toBeNull();
  });

  it('exports stripUnknownProperties function', () => {
    expect(typeof stripUnknownProperties).toBe('function');
  });

  it('stripUnknownProperties retains known keys and strips unknown', () => {
    const { props, warnings } = stripUnknownProperties(
      { Title: { title: [] }, 'Initiative ID': {}, Type: {} },
      ['Title', 'Type']
    );
    expect(props).toHaveProperty('Title');
    expect(props).toHaveProperty('Type');
    expect(props).not.toHaveProperty('Initiative ID');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('stripUnknownProperties returns empty warnings when all keys are known', () => {
    const { warnings } = stripUnknownProperties({ Name: {} }, ['Name']);
    expect(warnings).toHaveLength(0);
  });

  it('NOTION_PROPERTY_MAP.notionTask allowedKeys does not contain Status', () => {
    const keys = NOTION_PROPERTY_MAP.notionTask?.allowedKeys ?? [];
    expect(keys).not.toContain('Status');
  });
});
