import { describe, it, expect, vi } from 'vitest';
import { pushCaptureAtom, pushCapture } from '../capture-inbox.js';

describe('pushCaptureAtom', () => {
  it('pushCaptureAtom 先写 captures 再写 capture_atoms（两次 query）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'atom-1' }] }) };
    const id = await pushCaptureAtom(pool, {
      content: 'x', targetType: 'handoff', targetSubtype: 'PASS',
      routedToTable: 'tasks', routedToId: '11111111-1111-1111-1111-111111111111',
    });
    expect(id).toBe('atom-1');
    // calls[0] = INSERT INTO captures, calls[1] = INSERT INTO capture_atoms
    expect(pool.query.mock.calls).toHaveLength(2);
    const [sql1] = pool.query.mock.calls[0];
    expect(sql1).toMatch(/INSERT INTO captures/);
    const [sql2, params2] = pool.query.mock.calls[1];
    expect(sql2).toMatch(/INSERT INTO capture_atoms/);
    // capture_atoms params: [captureId, content, target_type, target_subtype, routed_to_table, routed_to_id, lane]
    // （08-04 签名修复：routedToTable/routedToId/lane 恢复落库，不再静默丢弃）
    expect(params2).toEqual(['atom-1', 'x', 'handoff', 'PASS', 'tasks', '11111111-1111-1111-1111-111111111111', null, '{}']);
  });

  it('content 超 2000 字截断（MAX_CONTENT_LEN=2000）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'a' }] }) };
    await pushCaptureAtom(pool, { content: 'x'.repeat(3000), targetType: 'learning' });
    // captures INSERT 是 calls[0]，content 是 params[0]
    expect(pool.query.mock.calls[0][1][0].length).toBe(2000);
  });

  it('pool 抛错时吞掉不 throw，返回 null', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(pushCaptureAtom(pool, { content: 'x', targetType: 'issue' })).resolves.toBeNull();
  });

  it('缺 content 或 targetType 直接返回 null 不查库', async () => {
    const pool = { query: vi.fn() };
    await expect(pushCaptureAtom(pool, { targetType: 'issue' })).resolves.toBeNull();
    await expect(pushCaptureAtom(pool, { content: 'x' })).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

/**
 * 幂等回归（F6加厚回归 — Contract ed911a7c）
 * 此 describe 块由 sprints/08060903-relay-ed911a7c/tests/capture-inbox-idempotent.test.js 追加，
 * 永久保留在 CI 作为 regression（合同 C3）。
 */
describe('pushCapture 幂等（F6加厚回归 — Contract ed911a7c）', () => {
  it('persists the complete coding routing baseline on a task atom', async () => {
    const pool = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'capture-route', inserted: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'atom-route' }] }) };
    const metadata = {
      repo: 'cecelia', change_kind: 'bugfix', map_scope: ['F0'],
      branch: 'cp-map-fix', base_sha: 'a'.repeat(40),
    };

    await pushCapture(pool, {
      content: 'fix map', targetType: 'task', targetSubtype: 'bugfix',
      routingMetadata: metadata,
    });

    const atomInsert = pool.query.mock.calls.find(([sql]) => /INSERT INTO capture_atoms/.test(sql));
    expect(atomInsert[0]).toMatch(/metadata/);
    expect(JSON.parse(atomInsert[1].at(-1))).toEqual(metadata);
  });

  it('[REGRESSION] ON CONFLICT 命中已有 capture 时返回 dedupeHit=true', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'cap-existing', inserted: false }] }),
    };

    const result = await pushCapture(pool, {
      content: 'Notion 已存在页面',
      source: 'notion',
      dedupeKey: 'notion:inbox:existing-page',
    });

    expect(result).toEqual({ captureId: 'cap-existing', atomId: null, dedupeHit: true });
  });

  it('[BEHAVIOR] capture_atoms INSERT 包含 ON CONFLICT DO NOTHING（B-1）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'cap-1' }] }) };
    await pushCapture(pool, {
      content: '测试页面',
      source: 'notion',
      dedupeKey: 'notion:inbox:test-page-id',
      notionPageId: 'test-page-id',
      targetType: 'notes',
      targetSubtype: 'notion_inbox',
    });
    const atomInsertCall = pool.query.mock.calls.find(c => /INSERT INTO capture_atoms/.test(c[0]));
    expect(atomInsertCall).toBeTruthy();
    expect(atomInsertCall[0]).toMatch(/ON CONFLICT \(capture_id, target_type\) DO NOTHING/);
  });

  it('[BEHAVIOR-3] ON CONFLICT DO NOTHING 时 atomId=null，函数不抛错，返回结构完整', async () => {
    const pool = {
      query: vi.fn().mockImplementation((sql) => {
        if (/INSERT INTO capture_atoms/.test(sql)) {
          // 模拟 DO NOTHING 路径：RETURNING 空数组
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [{ id: 'cap-2' }] });
      }),
    };

    const result = await pushCapture(pool, {
      content: '幂等冲突测试内容',
      source: 'notion',
      dedupeKey: 'notion:inbox:conflict-test-002',
      notionPageId: 'conflict-test-002',
      targetType: 'notes',
      targetSubtype: 'notion_inbox',
    });

    // 不抛错，返回完整结构
    expect(result).not.toBeNull();
    expect(result?.captureId).toBe('cap-2');
    // DO NOTHING 时 RETURNING 空，rows[0]?.id ?? null → null
    expect(result?.atomId).toBeNull();
  });

  it('[INV-4] 现有 pushCapture 无 targetType 时只写 captures，不写 capture_atoms', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'cap-3' }] }),
    };

    const result = await pushCapture(pool, {
      content: '无 targetType 内容',
      source: 'harness',
      dedupeKey: 'harness:no-target-003',
    });

    expect(result).not.toBeNull();
    expect(result?.captureId).toBe('cap-3');
    expect(result?.atomId).toBeNull();

    // 只有一次 query（captures INSERT），没有 capture_atoms INSERT
    expect(pool.query.mock.calls).toHaveLength(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/INSERT INTO captures/);
  });
});
