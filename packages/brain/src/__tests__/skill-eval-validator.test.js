/**
 * skill-eval-validator.test.js — skill-eval-validator.js 单元层测试
 * Sprint: 07072314-skill-eval-service
 *
 * 与 eval.test.js（合同/BEHAVIOR 测试）互补：
 * - eval.test.js：聚焦 BEHAVIOR 合同（完整 validator 调用链 + mock 场景组合）
 * - 本文件：validator 各函数的边界值、错误路径、DB 交互单元测试
 *
 * 覆盖函数：
 *   validateZipBuffer / computeZipHash / checkZipDuplication /
 *   checkSlotAvailable / checkQuotaSufficient / releaseSlot / getEvalQueuePosition
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB Pool ──────────────────────────────────────────────────────────
const mockPool = { query: vi.fn() };

// ─── 导入被测模块 ──────────────────────────────────────────────────────────
import {
  validateZipBuffer,
  computeZipHash,
  checkZipDuplication,
  checkSlotAvailable,
  checkQuotaSufficient,
  releaseSlot,
  getEvalQueuePosition,
} from '../skill-eval-validator.js';

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function makeZipBuf(size = 100) {
  const buf = Buffer.alloc(size);
  buf[0] = 0x50; buf[1] = 0x4b; buf[2] = 0x03; buf[3] = 0x04;
  return buf;
}

// ─── validateZipBuffer ─────────────────────────────────────────────────────

describe('skill-eval-validator.js — validateZipBuffer', () => {
  it('太小的 buffer → invalid', async () => {
    const result = await validateZipBuffer(Buffer.alloc(3));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too small/);
  });

  it('错误魔数 → invalid', async () => {
    const buf = Buffer.alloc(10);
    buf[0] = 0xff; buf[1] = 0xfe; buf[2] = 0x00; buf[3] = 0x00;
    const result = await validateZipBuffer(buf);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/magic bytes/);
  });

  it('mock 场景：正常 SKILL.md → valid', async () => {
    const buf = makeZipBuf();
    const result = await validateZipBuffer(buf, {
      mockEntries: ['SKILL.md', 'src/index.js'],
      mockUnzipTotalSize: 1024,
    });
    expect(result.valid).toBe(true);
    expect(result.entries).toContain('SKILL.md');
  });

  it('mock 场景：缺少 SKILL.md → invalid', async () => {
    const buf = makeZipBuf();
    const result = await validateZipBuffer(buf, {
      mockEntries: ['src/index.js', 'README.md'],
      mockUnzipTotalSize: 512,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing SKILL\.md/);
  });

  it('mock 场景：多个 SKILL.md → invalid', async () => {
    const buf = makeZipBuf();
    const result = await validateZipBuffer(buf, {
      mockEntries: ['SKILL.md', 'sub/SKILL.md'],
      mockUnzipTotalSize: 512,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/multiple SKILL\.md/);
  });

  it('mock 场景：路径穿越 → invalid', async () => {
    const buf = makeZipBuf();
    const result = await validateZipBuffer(buf, {
      mockEntries: ['SKILL.md', '../evil.sh'],
      mockUnzipTotalSize: 512,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/path traversal/);
  });

  it('mock 场景：解压超过 50MB → invalid', async () => {
    const buf = makeZipBuf();
    const result = await validateZipBuffer(buf, {
      mockEntries: ['SKILL.md'],
      mockUnzipTotalSize: 51 * 1024 * 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/超限|unzip size/);
  });

  it('mock 场景：entry 数量超过 2000 → invalid', async () => {
    const buf = makeZipBuf();
    const entries = Array.from({ length: 2001 }, (_, i) => `file-${i}.js`);
    entries.push('SKILL.md');
    const result = await validateZipBuffer(buf, {
      mockEntries: entries,
      mockUnzipTotalSize: 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too many entries/);
  });
});

// ─── computeZipHash ────────────────────────────────────────────────────────

describe('skill-eval-validator.js — computeZipHash', () => {
  it('相同内容产生相同 hash', () => {
    const buf = makeZipBuf();
    const h1 = computeZipHash(buf);
    const h2 = computeZipHash(buf);
    expect(h1).toBe(h2);
    expect(typeof h1).toBe('string');
    expect(h1.length).toBeGreaterThan(8);
  });

  it('不同内容产生不同 hash', () => {
    const buf1 = makeZipBuf(50);
    const buf2 = makeZipBuf(60);
    buf2[10] = 0xff;
    expect(computeZipHash(buf1)).not.toBe(computeZipHash(buf2));
  });
});

// ─── checkZipDuplication ──────────────────────────────────────────────────

describe('skill-eval-validator.js — checkZipDuplication', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('hash 不存在 → isDuplicate=false', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const result = await checkZipDuplication(mockPool, 'hash-abc');
    expect(result.isDuplicate).toBe(false);
  });

  it('hash 存在且 completed → isDuplicate=true + report_url', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        task_id: 'existing-task',
        status: 'completed',
        report_url: 'https://example.com/report.html',
      }],
    });
    const result = await checkZipDuplication(mockPool, 'hash-dup');
    expect(result.isDuplicate).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.report_url).toBe('https://example.com/report.html');
  });

  it('hash 存在且 pending → isDuplicate=true + status=pending', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ task_id: 'pending-task', status: 'pending', report_url: null }],
    });
    const result = await checkZipDuplication(mockPool, 'hash-pending');
    expect(result.isDuplicate).toBe(true);
    expect(result.status).toBe('pending');
  });
});

// ─── checkSlotAvailable ───────────────────────────────────────────────────

describe('skill-eval-validator.js — checkSlotAvailable', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('pending < MAX_SKILL_EVAL_QUEUE → queueFull=false', async () => {
    // 两个独立查询：in_progress 和 pending（都用 count 别名）
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // in_progress
      .mockResolvedValueOnce({ rows: [{ count: '5' }] }); // pending
    const result = await checkSlotAvailable(mockPool);
    expect(result.queueFull).toBe(false);
  });

  it('pending >= MAX_SKILL_EVAL_QUEUE → queueFull=true', async () => {
    const maxQueue = parseInt(process.env.MAX_SKILL_EVAL_QUEUE || '20', 10);
    // 两个独立查询：in_progress 和 pending（都用 count 别名）
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // in_progress
      .mockResolvedValueOnce({ rows: [{ count: String(maxQueue) }] }); // pending >= maxQueue
    const result = await checkSlotAvailable(mockPool);
    expect(result.queueFull).toBe(true);
  });
});

// ─── checkQuotaSufficient ─────────────────────────────────────────────────

describe('skill-eval-validator.js — checkQuotaSufficient', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('无快照数据 → 保守放行 canDispatch=true', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await checkQuotaSufficient(mockPool, 'account2');
    expect(result.canDispatch).toBe(true);
    warnSpy.mockRestore();
  });

  it('5h 额度充足（≥85% remaining）→ canDispatch=true', async () => {
    // 5h remaining=90% >= 85%, 7d remaining=95% >= 90% → 允许派发
    mockPool.query.mockResolvedValue({
      rows: [{ pool_5h_remaining_pct: 90, pool_7d_remaining_pct: 95 }],
    });
    const result = await checkQuotaSufficient(mockPool, 'account2');
    expect(result.canDispatch).toBe(true);
  });

  it('5h 额度不足 → canDispatch=false', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ pool_5h_remaining_pct: 1, pool_7d_remaining_pct: 80 }],
    });
    const result = await checkQuotaSufficient(mockPool, 'account2');
    expect(result.canDispatch).toBe(false);
    expect(result.reason).toMatch(/5h quota/);
  });

  it('DB 查询失败 → 保守放行 canDispatch=true', async () => {
    mockPool.query.mockRejectedValue(new Error('db error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await checkQuotaSufficient(mockPool, 'account2');
    expect(result.canDispatch).toBe(true);
    warnSpy.mockRestore();
  });
});

// ─── releaseSlot ──────────────────────────────────────────────────────────

describe('skill-eval-validator.js — releaseSlot', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('正常调用写入 skill_evals + tasks', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await releaseSlot(mockPool, 'task-123', 'dispatch');
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    // 第一个调用更新 skill_evals
    const firstCall = mockPool.query.mock.calls[0];
    expect(firstCall[0]).toMatch(/skill_evals/);
    expect(firstCall[1][0]).toBe('failed(dispatch)');
    expect(firstCall[1][1]).toBe('task-123');
  });

  it('无效 failureMode → 用 failed(unknown:xxx)', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await releaseSlot(mockPool, 'task-xyz', 'weird-mode');
    const reason = mockPool.query.mock.calls[0][1][0];
    expect(reason).toMatch(/unknown/);
  });

  it('DB 写入失败时不抛出（slot 释放铁律）', async () => {
    mockPool.query.mockRejectedValue(new Error('connection lost'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(releaseSlot(mockPool, 'task-fail', 'crash')).resolves.toBeUndefined();
    errSpy.mockRestore();
  });
});

// ─── getEvalQueuePosition ─────────────────────────────────────────────────

describe('skill-eval-validator.js — getEvalQueuePosition', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('返回队列位次（1-based）', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ position: 3 }] });
    const pos = await getEvalQueuePosition(mockPool, 'task-abc');
    expect(pos).toBe(3);
  });

  it('position 为 null → 返回 null', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ position: null }] });
    const pos = await getEvalQueuePosition(mockPool, 'task-xyz');
    expect(pos).toBeNull();
  });

  it('空结果 → 返回 null', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const pos = await getEvalQueuePosition(mockPool, 'no-task');
    expect(pos).toBeNull();
  });
});
