import { describe, it, expect, vi } from 'vitest';
import { projectManagedProfile } from './notion-content.js';
describe('CRM managed content', () => {
  const customer = { id: 'customer', source_page_id: 'page', profile_managed: true, profile_markdown: '## 当前画像\n预算 8000 元' };
  it('only replaces the delimited owned region and preserves human content', async () => {
    const request = vi.fn().mockResolvedValueOnce({ markdown: '人工笔记 KEEP\n**BRAIN-CRM-START:customer**\n旧画像\n**BRAIN-CRM-END:customer**\n人工结尾', truncated: false }).mockResolvedValueOnce({});
    await projectManagedProfile(request, customer);
    const body = request.mock.calls[1][2];
    expect(body.update_content.content_updates[0].old_str).not.toContain('KEEP');
    expect(body.update_content.content_updates[0].new_str).toContain('8000');
  });
  it('refuses damaged or duplicated boundaries instead of replacing the page', async () => {
    const request = vi.fn(async () => ({ markdown: '**BRAIN-CRM-START:customer**\n人工备注', truncated: false }));
    await expect(projectManagedProfile(request, customer)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
