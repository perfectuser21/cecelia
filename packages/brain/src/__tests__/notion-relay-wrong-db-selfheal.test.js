/**
 * 回归：relay 投影 project 推送遇「错库」400 永不自愈（2026-09-29 生产实证）
 * 3 个 project 根（cf1bae42 / 4dd12ae1 / bf5088a3）的 notion_id 指向旧 Cecelia Tasks 库（3b7c40c2…e356，迁移 488 已登记 archived），
 * PATCH 按 Projects 库属性发 → 400「Status is expected to be select. AI Project is not a property that exists」。
 * 旧 isGone 只认 404 / archived ancestor，这种 400 每轮重试失败。
 * 期望：与 notion-push-sync 的 isWrongDatabaseError 同款判据 → 放弃旧页，在正确的 Projects 库 POST 重建，回存新 notion_id 与指纹。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'tok' }));

import { pushProjectRoots, PROJECTS_DB } from '../notion-relay-projection.js';
import { isWrongDatabaseError } from '../lib/notion-projection-engine.js';

const WRONG_DB_MSG = 'Notion PATCH /pages/legacy → 400: Status is expected to be select. AI Project is not a property that exists. Run ID is not a property that exists. Remark is not a property that exists.';

function poolFor(root, updates) {
  return { query: vi.fn(async (sql, params) => {
    if (/FROM tasks\s+WHERE task_type = 'project'/.test(sql)) return { rows: [root] };
    if (/UPDATE tasks SET notion_id/.test(sql)) { updates.push(params); return { rows: [] }; }
    return { rows: [] };
  }) };
}

describe('relay project 错库 400 自愈', () => {
  it('isWrongDatabaseError 由统一引擎导出：schema 不符的 400 为真，archived/普通 400 为假', () => {
    expect(isWrongDatabaseError(new Error(WRONG_DB_MSG))).toBe(true);
    expect(isWrongDatabaseError(new Error("400: Can't edit page on block with an archived ancestor"))).toBe(false);
    expect(isWrongDatabaseError(new Error('400: body failed validation'))).toBe(false);
  });

  it('legacy notion_id 指向错库 → 在 Projects 库 POST 重建，回存新 id + 指纹 + project_db', async () => {
    const updates = [];
    const root = { id: 'cf1bae42-0a0d-42e6-aff1-7c848de71620', title: '接力棒：验证层', description: 'd', status: 'queued',
      notion_id: 'legacy', notion_props: null };
    const req = vi.fn(async (t, path, method, body) => {
      if (method === 'PATCH' && path === '/pages/legacy') throw new Error(WRONG_DB_MSG);
      if (method === 'POST' && path === '/pages') { expect(body.parent.database_id).toBe(PROJECTS_DB); return { id: 'new-proj-page' }; }
      return {};
    });
    const s = await pushProjectRoots(poolFor(root, updates), 'tok', { notionReq: req, log: { warn: () => {} } });
    expect(s).toEqual({ pushed: 1, skipped: 0, failed: 0 });
    expect(updates[0][1]).toBe('new-proj-page');
    expect(updates[0][2]).toHaveLength(40);
    expect(updates[0][3]).toBe(PROJECTS_DB);
  });

  it('其他 400（非错库、非回收站）仍按失败计，不重建', async () => {
    const updates = [];
    const root = { id: '11111111-1111-4111-8111-111111111111', title: 'p', description: 'd', status: 'queued',
      notion_id: 'p1', notion_props: null };
    const req = vi.fn(async (t, path, method) => {
      if (method === 'PATCH') throw new Error('Notion PATCH → 400: body failed validation: rich_text too long');
      if (method === 'POST') return { id: 'should-not-create' };
      return {};
    });
    const s = await pushProjectRoots(poolFor(root, updates), 'tok', { notionReq: req, log: { warn: () => {} } });
    expect(s.failed).toBe(1);
    expect(req.mock.calls.some((c) => c[2] === 'POST')).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
