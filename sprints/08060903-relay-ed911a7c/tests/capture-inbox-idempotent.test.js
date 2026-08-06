/**
 * 合同测试 — capture_atoms 幂等回归（F6加厚 sprint ed911a7c）
 *
 * 验证 [BEHAVIOR-1][BEHAVIOR-2][BEHAVIOR-3]：
 *   同一 dedupeKey 二次调用 pushCapture 不触发第二次 capture_atoms INSERT
 *
 * 此测试文件为 sprint contract 产物，执行时被复制/引用到
 * packages/brain/src/__tests__/capture-inbox.test.js 作为永久 regression。
 */
import { describe, it, expect, vi } from 'vitest';
import { pushCapture } from '../../../packages/brain/src/capture-inbox.js';

describe('pushCapture 幂等（F6加厚回归 — Contract ed911a7c）', () => {
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
