/**
 * notionBlockToDBRow 重构验证测试
 * 验证 dispatch-table 模式与原 switch 行为等价
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import { notionBlockToDBRow } from '../notion-sync.js';

const PARENT = 'test-knowledge-id';
const IDX = 0;

function block(type, data) {
  return { id: `block-${type}`, type, ...data };
}

describe('notionBlockToDBRow — dispatch-table 重构等价性', () => {
  it('paragraph', () => {
    const b = block('paragraph', { paragraph: { rich_text: [{ plain_text: 'hello' }] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'paragraph', content: { text: 'hello' } });
  });

  it('heading_1', () => {
    const b = block('heading_1', { heading_1: { rich_text: [{ plain_text: 'Title' }] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'heading', content: { level: 1, text: 'Title' } });
  });

  it('heading_2', () => {
    const b = block('heading_2', { heading_2: { rich_text: [{ plain_text: 'Sub' }] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'heading', content: { level: 2, text: 'Sub' } });
  });

  it('heading_3', () => {
    const b = block('heading_3', { heading_3: { rich_text: [{ plain_text: 'Sub3' }] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'heading', content: { level: 3, text: 'Sub3' } });
  });

  it('bulleted_list_item → ordered: false', () => {
    const b = block('bulleted_list_item', { bulleted_list_item: { rich_text: [{ plain_text: 'item' }] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'list_item', content: { text: 'item', ordered: false } });
  });

  it('numbered_list_item → ordered: true', () => {
    const b = block('numbered_list_item', { numbered_list_item: { rich_text: [{ plain_text: 'item' }] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'list_item', content: { text: 'item', ordered: true } });
  });

  it('code', () => {
    const b = block('code', { code: { rich_text: [{ plain_text: 'const x = 1' }], language: 'javascript' } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'code', content: { text: 'const x = 1', language: 'javascript' } });
  });

  it('code — 无 language 时默认 plain text', () => {
    const b = block('code', { code: { rich_text: [{ plain_text: 'x' }] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row.content.language).toBe('plain text');
  });

  it('image — external url', () => {
    const b = block('image', { image: { external: { url: 'https://example.com/img.png' }, caption: [] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'image', content: { url: 'https://example.com/img.png' } });
  });

  it('image — file url fallback', () => {
    const b = block('image', { image: { file: { url: 'https://cdn.notion.so/img.png' }, caption: [] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row.content.url).toBe('https://cdn.notion.so/img.png');
  });

  it('divider → empty content', () => {
    const b = block('divider', {});
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'divider', content: {} });
  });

  it('quote', () => {
    const b = block('quote', { quote: { rich_text: [{ plain_text: 'wise words' }] } });
    const row = notionBlockToDBRow(b, PARENT, IDX);
    expect(row).toMatchObject({ type: 'quote', content: { text: 'wise words' } });
  });

  it('未知类型返回 null（跳过）', () => {
    const b = block('callout', { callout: {} });
    expect(notionBlockToDBRow(b, PARENT, IDX)).toBeNull();
  });

  it('child_page 返回 null', () => {
    expect(notionBlockToDBRow(block('child_page', {}), PARENT, IDX)).toBeNull();
  });

  it('返回结构包含 notion_id / parent_id / order_index', () => {
    const b = block('paragraph', { paragraph: { rich_text: [] } });
    const row = notionBlockToDBRow(b, PARENT, 5);
    expect(row.notion_id).toBe('block-paragraph');
    expect(row.parent_id).toBe(PARENT);
    expect(row.parent_type).toBe('knowledge');
    expect(row.order_index).toBe(5);
  });
});
