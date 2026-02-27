/**
 * backfill-l1.js 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseArgs,
  L1_PROMPT_TEMPLATE,
  fetchPendingRecords,
  processRecord,
  runBackfill,
} from '../scripts/backfill-l1.js';

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('BL-1: 默认 limit=100，dryRun=false', () => {
    expect(parseArgs([])).toEqual({ limit: 100, dryRun: false });
  });

  it('BL-2: --limit 20 正确解析', () => {
    expect(parseArgs(['--limit', '20'])).toEqual({ limit: 20, dryRun: false });
  });

  it('BL-3: --dry-run 正确解析', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ limit: 100, dryRun: true });
  });

  it('BL-4: --limit 和 --dry-run 组合', () => {
    expect(parseArgs(['--limit', '5', '--dry-run'])).toEqual({ limit: 5, dryRun: true });
  });

  it('BL-5: 非法 limit 值忽略，保持默认', () => {
    expect(parseArgs(['--limit', 'abc'])).toEqual({ limit: 100, dryRun: false });
  });
});

// ─── L1_PROMPT_TEMPLATE ──────────────────────────────────────────────────────

describe('L1_PROMPT_TEMPLATE', () => {
  it('BL-6: prompt 包含四个字段标签', () => {
    const prompt = L1_PROMPT_TEMPLATE('test content');
    expect(prompt).toContain('**核心事实**');
    expect(prompt).toContain('**背景场景**');
    expect(prompt).toContain('**关键判断**');
    expect(prompt).toContain('**相关实体**');
  });

  it('BL-7: content 超过 1500 字时截断', () => {
    const longContent = 'x'.repeat(2000);
    const prompt = L1_PROMPT_TEMPLATE(longContent);
    // 截断后的内容不超过 1500 字
    expect(prompt).toContain('x'.repeat(1500));
    expect(prompt).not.toContain('x'.repeat(1501));
  });
});

// ─── fetchPendingRecords ─────────────────────────────────────────────────────

describe('fetchPendingRecords', () => {
  it('BL-8: 查询排除 self_model 记录', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: 'a', content: 'hello', importance: 9 },
          { id: 'b', content: 'world', importance: 7 },
        ],
      }),
    };

    const records = await fetchPendingRecords(mockPool, 10);
    expect(records).toHaveLength(2);

    // 验证 SQL 包含 self_model 排除条件
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain("source_type != 'self_model'");
    expect(sql).toContain('l1_content IS NULL');
  });

  it('BL-9: limit 参数正确传递', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    await fetchPendingRecords(mockPool, 42);
    expect(mockPool.query.mock.calls[0][1]).toEqual([42]);
  });
});

// ─── processRecord ───────────────────────────────────────────────────────────

describe('processRecord', () => {
  it('BL-10: 正常生成 L1 并写入 DB', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const mockCallLLM = vi.fn().mockResolvedValue({ text: '**核心事实**：测试\n**背景场景**：场景\n**关键判断**：判断\n**相关实体**：实体' });
    const record = { id: 'test-id', content: '这是测试内容', importance: 8 };

    const result = await processRecord(mockPool, mockCallLLM, record);

    expect(mockCallLLM).toHaveBeenCalledWith('memory', expect.stringContaining('这是测试内容'), expect.any(Object));
    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE memory_stream SET l1_content = $1 WHERE id = $2',
      [expect.stringContaining('核心事实'), 'test-id']
    );
    expect(result).toContain('核心事实');
  });

  it('BL-11: LLM 返回空时抛出错误', async () => {
    const mockPool = { query: vi.fn() };
    const mockCallLLM = vi.fn().mockResolvedValue({ text: '' });
    const record = { id: 'test-id', content: '内容', importance: 5 };

    await expect(processRecord(mockPool, mockCallLLM, record)).rejects.toThrow('LLM 返回空内容');
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

// ─── runBackfill ─────────────────────────────────────────────────────────────

describe('runBackfill', () => {
  let mockPool;
  let mockCallLLM;

  beforeEach(() => {
    mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockCallLLM = vi.fn().mockResolvedValue({ text: '**核心事实**：x\n**背景场景**：y\n**关键判断**：z\n**相关实体**：w' });
  });

  it('BL-12: dry-run 模式不调用 LLM，不写 DB', async () => {
    const records = [
      { id: 'a', content: '内容A', importance: 9 },
      { id: 'b', content: '内容B', importance: 7 },
    ];

    const result = await runBackfill(mockPool, mockCallLLM, records, { dryRun: true });

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.success).toBe(0);
  });

  it('BL-13: 正常模式处理所有记录', async () => {
    const records = [
      { id: 'r1', content: '内容1', importance: 8 },
      { id: 'r2', content: '内容2', importance: 6 },
    ];

    const result = await runBackfill(mockPool, mockCallLLM, records, { dryRun: false });

    expect(result.success).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockCallLLM).toHaveBeenCalledTimes(2);
  });

  it('BL-14: 单条失败不影响其他记录处理', async () => {
    const records = [
      { id: 'ok1', content: '正常内容', importance: 9 },
      { id: 'fail', content: '失败内容', importance: 8 },
      { id: 'ok2', content: '另一正常', importance: 7 },
    ];

    // 第二条 LLM 返回空（会失败）
    mockCallLLM
      .mockResolvedValueOnce({ text: '**核心事实**：x\n**背景场景**：y\n**关键判断**：z\n**相关实体**：w' })
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ text: '**核心事实**：x\n**背景场景**：y\n**关键判断**：z\n**相关实体**：w' });

    const result = await runBackfill(mockPool, mockCallLLM, records, { dryRun: false });

    expect(result.success).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(3);
    // 三条都被尝试处理
    expect(mockCallLLM).toHaveBeenCalledTimes(3);
  });
});
