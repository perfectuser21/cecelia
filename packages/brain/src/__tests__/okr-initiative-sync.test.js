/**
 * okr-initiative-sync 单元测试（PR 2b-2b：harness → okr_initiatives 活态镜像）
 *
 * 验证解析三分支（映射表 → tasks.okr_initiative_id → 新建）+ 状态同步 SQL。
 * 全部 non-fatal 由调用方包裹；这里测纯逻辑（mock pool 捕获 query）。
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveOrCreateOkrInitiative, syncOkrInitiativeStatus } from '../okr-initiative-sync.js';

const TASK = 'aaaa0001-0000-0000-0000-000000000001';
const OKR_FROM_MAP = 'bbbb0001-0000-0000-0000-000000000001';
const OKR_FROM_TASK = 'cccc0001-0000-0000-0000-000000000001';
const OKR_NEW = 'dddd0001-0000-0000-0000-000000000001';

describe('resolveOrCreateOkrInitiative — 分支 1：映射表命中', () => {
  it('映射表已有 → 直接返回，不查 tasks 不新建', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes('FROM harness_initiative_migration_map')) return { rows: [{ okr_initiative_id: OKR_FROM_MAP }] };
      return { rows: [] };
    }) };
    const id = await resolveOrCreateOkrInitiative(pool, TASK);
    expect(id).toBe(OKR_FROM_MAP);
    const sqls = pool.query.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes('INSERT INTO okr_initiatives'))).toBe(false);
  });
});

describe('resolveOrCreateOkrInitiative — 分支 2：tasks.okr_initiative_id 命中', () => {
  it('映射表空但 task 有 okr_initiative_id → 用它并回填映射表', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes('FROM harness_initiative_migration_map')) return { rows: [] };
      if (sql.startsWith('SELECT') && sql.includes('FROM tasks')) return { rows: [{ id: TASK, title: 'T', okr_initiative_id: OKR_FROM_TASK, project_id: null, description: null }] };
      return { rows: [] };
    }) };
    const id = await resolveOrCreateOkrInitiative(pool, TASK);
    expect(id).toBe(OKR_FROM_TASK);
    const sqls = pool.query.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes('INSERT INTO harness_initiative_migration_map'))).toBe(true);
    expect(sqls.some(s => s.includes('INSERT INTO okr_initiatives'))).toBe(false);
  });
});

describe('resolveOrCreateOkrInitiative — 分支 3：新建', () => {
  it('映射表与 task 均无 → INSERT okr_initiatives(running) + 写映射表 + 回写 tasks', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes('FROM harness_initiative_migration_map')) return { rows: [] };
      if (sql.startsWith('SELECT') && sql.includes('FROM tasks')) return { rows: [{ id: TASK, title: 'T', okr_initiative_id: null, project_id: null, description: null }] };
      if (sql.includes('INSERT INTO okr_initiatives')) return { rows: [{ id: OKR_NEW }] };
      return { rows: [] };
    }) };
    const id = await resolveOrCreateOkrInitiative(pool, TASK);
    expect(id).toBe(OKR_NEW);
    const sqls = pool.query.mock.calls.map(c => c[0]);
    const insInit = sqls.find(s => s.includes('INSERT INTO okr_initiatives'));
    expect(insInit).toBeDefined();
    expect(insInit).toContain("'running'");                       // 新建即 running
    expect(insInit).toContain('harness_live');                    // 来源标记
    expect(sqls.some(s => s.includes('UPDATE tasks SET okr_initiative_id'))).toBe(true);
  });

  it('task 不存在 → 返回 null（不抛）', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes('FROM harness_initiative_migration_map')) return { rows: [] };
      return { rows: [] }; // tasks 查不到
    }) };
    const id = await resolveOrCreateOkrInitiative(pool, TASK);
    expect(id).toBeNull();
  });
});

describe('syncOkrInitiativeStatus — 状态同步', () => {
  it('running（非终态）→ UPDATE status=running，不设 completed_at', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes('FROM harness_initiative_migration_map')) return { rows: [{ okr_initiative_id: OKR_FROM_MAP }] };
      return { rows: [] };
    }) };
    const id = await syncOkrInitiativeStatus(pool, TASK, 'running');
    expect(id).toBe(OKR_FROM_MAP);
    const upd = pool.query.mock.calls.map(c => c[0]).find(s => s.includes('UPDATE okr_initiatives SET status'));
    expect(upd).toBeDefined();
    expect(upd).not.toContain('completed_at');
  });

  it('done（终态）→ UPDATE status=done + 设 completed_at', async () => {
    const pool = { query: vi.fn(async (sql) => {
      if (sql.includes('FROM harness_initiative_migration_map')) return { rows: [{ okr_initiative_id: OKR_FROM_MAP }] };
      return { rows: [] };
    }) };
    await syncOkrInitiativeStatus(pool, TASK, 'done');
    const upd = pool.query.mock.calls.map(c => c[0]).find(s => s.includes('UPDATE okr_initiatives SET status'));
    expect(upd).toContain('completed_at');
  });

  it('非法 lifecycle 值 → 抛错（防止写坏 CHECK）', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(syncOkrInitiativeStatus(pool, TASK, 'active')).rejects.toThrow();
  });
});
