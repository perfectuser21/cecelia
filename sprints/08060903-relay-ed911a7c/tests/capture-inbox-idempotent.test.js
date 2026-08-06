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
  it('[BEHAVIOR-1][BEHAVIOR-2] 同一 dedupeKey 二次调用 pushCapture，capture_atoms INSERT 只触发一次', async () => {
    let captureAtomInsertCount = 0;

    const pool = {
      query: vi.fn().mockImplementation((sql) => {
        if (/INSERT INTO capture_atoms/.test(sql)) {
          captureAtomInsertCount++;
          // 首次成功返回 atom，二次 DO NOTHING 返回空 rows
          return Promise.resolve({
            rows: captureAtomInsertCount === 1 ? [{ id: 'atom-1' }] : [],
          });
        }
        // captures INSERT（ON CONFLICT DO UPDATE）始终返回同一 captureId
        return Promise.resolve({ rows: [{ id: 'cap-1' }] });
      }),
    };

    const args = {
      content: '测试页面标题-幂等验证',
      source: 'notion',
      dedupeKey: 'notion:inbox:test-page-idempotent-001',
      notionPageId: 'test-page-idempotent-001',
      targetType: 'notes',
      targetSubtype: 'notion_inbox',
    };

    // [BEHAVIOR-2] 首次采集：正常写入
    const r1 = await pushCapture(pool, args);
    expect(r1).not.toBeNull();
    expect(r1?.captureId).toBe('cap-1');
    expect(r1?.atomId).toBe('atom-1');

    const atomInsertCountAfterFirst = captureAtomInsertCount;
    expect(atomInsertCountAfterFirst).toBe(1);

    // [BEHAVIOR-1] 二次采集（同一页面）：capture_atoms INSERT 不再新增
    const r2 = await pushCapture(pool, args);
    expect(r2).not.toBeNull();
    expect(r2?.captureId).toBe('cap-1'); // 同一 captureId（ON CONFLICT DO UPDATE）

    // 核心断言：capture_atoms INSERT 调用次数未增加
    expect(captureAtomInsertCount).toBe(atomInsertCountAfterFirst);
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
