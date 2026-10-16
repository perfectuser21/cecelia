import { describe, it, expect, vi } from 'vitest';
import { updateProfile, saveReport } from './store.js';
import { projectManagedProfile } from './notion-content.js';
import { validateCrmMarkdown } from './markdown.js';
import { spawnSync } from 'node:child_process';
const tenant = '20000000-0000-4000-8000-000000000001', customer = '20000000-0000-4000-8000-000000000002';
describe('CRM prose cannot move Notion structures', () => {
  it('长空白非结构标签在隔离Node子进程1秒预算内返回，不冻结测试线程', () => {
    const moduleUrl = new URL('./markdown.js', import.meta.url).href;
    const code = `import {validateCrmMarkdown} from ${JSON.stringify(moduleUrl)}; validateCrmMarkdown('<'+'\\t'.repeat(60000)+'other');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 1000, encoding: 'utf8' });
    expect(result.error?.code).not.toBe('ETIMEDOUT'); expect(result.status).toBe(0);
  });
  it.each(['page', 'database', 'folder', 'synced_block', 'synced-block-reference', 'custom-block'])('兼容带空白的开闭结构标签拒绝 %s', tag => {
    for (const value of [`<\t ${tag}>`, `<\t /\t ${tag.toUpperCase()}>`]) {
      expect(() => validateCrmMarkdown(value)).toThrow();
    }
    expect(validateCrmMarkdown('<\t other>')).toBe('<\t other>');
  });
  for (const markdown of ['<database url="https://notion.so/existing"/>', '<PAGE url="https://notion.so/existing"/>', '<\n /database>']) {
    it(`rejects structural markup before database or external writes: ${markdown.slice(0, 15)}`, async () => {
      const db = { query: vi.fn(async () => ({ rows: [] })) };
      await expect(updateProfile(db, tenant, customer, { expected_revision: 1, profile_markdown: markdown })).rejects.toMatchObject({ code: 'invalid_markdown' });
      await expect(saveReport(db, tenant, { customer_id: customer, type: 'daily', period_start: '2026-10-16', period_end: '2026-10-16', version: 1, markdown, message_ids: [] })).rejects.toMatchObject({ code: 'invalid_markdown' });
      const request = vi.fn();
      await expect(projectManagedProfile(request, { id: customer, source_page_id: customer, profile_managed: true, profile_markdown: markdown })).rejects.toMatchObject({ code: 'invalid_markdown' });
      expect(db.query).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    });
  }
});
