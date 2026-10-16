import { describe, it, expect, vi } from 'vitest';
import { updateProfile, saveReport } from './store.js';
import { projectManagedProfile } from './notion-content.js';
const tenant = '20000000-0000-4000-8000-000000000001', customer = '20000000-0000-4000-8000-000000000002';
describe('CRM prose cannot move Notion structures', () => {
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
