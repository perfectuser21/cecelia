import { describe, it, expect } from 'vitest';
import { NOTION_PROPERTY_MAP, stripUnknownProperties } from './notion-property-map.js';

describe('NOTION_PROPERTY_MAP', () => {
  it('exports aiNotes with dbId and allowedKeys', () => {
    expect(NOTION_PROPERTY_MAP.aiNotes).toBeDefined();
    expect(typeof NOTION_PROPERTY_MAP.aiNotes.dbId).toBe('string');
    expect(Array.isArray(NOTION_PROPERTY_MAP.aiNotes.allowedKeys)).toBe(true);
  });

  it('aiNotes allowedKeys does not include Initiative ID', () => {
    expect(NOTION_PROPERTY_MAP.aiNotes.allowedKeys).not.toContain('Initiative ID');
  });

  it('notionTask allowedKeys does not include Status (防 Bug 2 回归)', () => {
    expect(NOTION_PROPERTY_MAP.notionTask.allowedKeys).not.toContain('Status');
  });

  it('notionTask allowedKeys includes Name (Tasks DB title property)', () => {
    expect(NOTION_PROPERTY_MAP.notionTask.allowedKeys).toContain('Name');
  });

  it('stepLinks allowedKeys does not include Order (已删除)', () => {
    expect(NOTION_PROPERTY_MAP.stepLinks.allowedKeys).not.toContain('Order');
  });
});

describe('stripUnknownProperties', () => {
  it('passes through known properties', () => {
    const { props, warnings } = stripUnknownProperties(
      { Title: { title: [] }, Type: { select: { name: 'Note' } } },
      ['Title', 'Type'],
    );
    expect(props.Title).toBeDefined();
    expect(props.Type).toBeDefined();
    expect(warnings).toHaveLength(0);
  });

  it('strips unknown properties and adds warnings', () => {
    const { props, warnings } = stripUnknownProperties(
      { Title: { title: [] }, FakeField: { rich_text: [] } },
      ['Title'],
    );
    expect(props.Title).toBeDefined();
    expect(props.FakeField).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('FakeField');
  });

  it('returns empty props and no warnings for empty input', () => {
    const { props, warnings } = stripUnknownProperties({}, ['Title']);
    expect(props).toEqual({});
    expect(warnings).toHaveLength(0);
  });

  it('strips all properties when none are allowed', () => {
    const { props, warnings } = stripUnknownProperties(
      { A: 1, B: 2 },
      [],
    );
    expect(props).toEqual({});
    expect(warnings).toHaveLength(2);
  });
});
