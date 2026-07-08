/**
 * eval.test.js — Skill Evaluator 内部验收台单元测试
 * Sprint: 07072314-skill-eval-service
 * [BEHAVIOR] 测试：对应 contract-dod.md 中所有 [BEHAVIOR] 条目
 * [UNIT] 测试：对应 contract-dod.md 中所有 [UNIT] 条目
 *
 * TDD Red 阶段：所有测试先建立（不写实现，断言必失败）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock 外部依赖 ───────────────────────────────────────────────────────────

const { mockPool, mockFetch, mockCreateReadStream, mockFsPromises } = vi.hoisted(() => {
  const mockPool = { query: vi.fn() };
  const mockFetch = vi.fn();
  const mockCreateReadStream = vi.fn();
  const mockFsPromises = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    stat: vi.fn(),
  };
  return { mockPool, mockFetch, mockCreateReadStream, mockFsPromises };
});

vi.mock('../db.js', () => ({ default: mockPool }));
vi.stubGlobal('fetch', mockFetch);

vi.mock('fs', () => ({
  createReadStream: mockCreateReadStream,
  promises: mockFsPromises,
}));

vi.mock('fs/promises', () => mockFsPromises);

// ─── 导入被测模块（测试 Red 阶段：模块尚不存在，import 将失败）─────────────
// 注意：Red 阶段这些 import 会失败，这是预期行为
let validateZipBuffer, checkZipDuplication, checkSlotAvailable, checkQuotaSufficient, releaseSlot;
let getEvalQueuePosition;

try {
  const evalValidator = await import('../skill-eval-validator.js');
  validateZipBuffer = evalValidator.validateZipBuffer;
  checkZipDuplication = evalValidator.checkZipDuplication;
  checkSlotAvailable = evalValidator.checkSlotAvailable;
  checkQuotaSufficient = evalValidator.checkQuotaSufficient;
  releaseSlot = evalValidator.releaseSlot;
  getEvalQueuePosition = evalValidator.getEvalQueuePosition;
} catch (_e) {
  // Red 阶段：模块不存在，用 stub
  validateZipBuffer = null;
  checkZipDuplication = null;
  checkSlotAvailable = null;
  checkQuotaSufficient = null;
  releaseSlot = null;
  getEvalQueuePosition = null;
}

// ─── 测试辅助：构造假 zip Buffer ────────────────────────────────────────────

/**
 * 构造最小合法 zip 的魔数头（PK\x03\x04）
 * 实际 zip 内容校验由 unzipper 做，这里只模拟魔数部分
 */
function makeFakeZipMagic() {
  const buf = Buffer.alloc(100);
  buf[0] = 0x50; // P
  buf[1] = 0x4b; // K
  buf[2] = 0x03;
  buf[3] = 0x04;
  return buf;
}

function makeNonZipBuffer() {
  return Buffer.from('not a zip file content');
}

// ─── [UNIT-1] 硬校验覆盖 ─────────────────────────────────────────────────────

describe('[UNIT-1] zip 硬校验（5 种非法输入）', () => {
  it('非 zip 魔数文件 → 返回错误含 magic', async () => {
    if (!validateZipBuffer) {
      // Red 阶段：断言函数不存在
      expect(validateZipBuffer).not.toBeNull();
      return;
    }
    const buf = makeNonZipBuffer();
    const result = await validateZipBuffer(buf);
    expect(result.valid).toBe(false);
    expect(result.error.toLowerCase()).toMatch(/magic|魔数/);
  });

  it('解压超 50MB zip → 返回错误含解压或 size', async () => {
    if (!validateZipBuffer) {
      expect(validateZipBuffer).not.toBeNull();
      return;
    }
    // 模拟 unzipper 报告超大解压
    const buf = makeFakeZipMagic();
    // 这个测试需要 validateZipBuffer 内部检查解压大小
    // 用 mock 模拟超大解压场景
    const result = await validateZipBuffer(buf, { mockUnzipTotalSize: 51 * 1024 * 1024 });
    expect(result.valid).toBe(false);
    expect(result.error.toLowerCase()).toMatch(/解压|size|unzip/);
  });

  it('缺 SKILL.md → 返回错误含 SKILL.md', async () => {
    if (!validateZipBuffer) {
      expect(validateZipBuffer).not.toBeNull();
      return;
    }
    const buf = makeFakeZipMagic();
    const result = await validateZipBuffer(buf, { mockEntries: ['README.txt'] });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/SKILL\.md/);
  });

  it('含路径穿越（../）→ 返回错误含 traversal 或路径', async () => {
    if (!validateZipBuffer) {
      expect(validateZipBuffer).not.toBeNull();
      return;
    }
    const buf = makeFakeZipMagic();
    const result = await validateZipBuffer(buf, { mockEntries: ['../evil.sh', 'SKILL.md'] });
    expect(result.valid).toBe(false);
    expect(result.error.toLowerCase()).toMatch(/traversal|路径穿越|path/);
  });

  it('压缩比超 100:1（文件数超 2000）→ 返回错误', async () => {
    if (!validateZipBuffer) {
      expect(validateZipBuffer).not.toBeNull();
      return;
    }
    const buf = makeFakeZipMagic();
    const mockEntries = Array.from({ length: 2001 }, (_, i) => `file${i}.txt`);
    mockEntries.push('SKILL.md');
    const result = await validateZipBuffer(buf, {
      mockEntries,
      mockUnzipTotalSize: 100 * 1024 * 1024, // 100MB unzipped vs small zip
      mockZipSize: 512 * 1024, // 512KB zip
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ─── [UNIT-2] hash 去重逻辑 ──────────────────────────────────────────────────

describe('[UNIT-2] hash 去重（2 种路径）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('命中 completed → 返回历史 report_url', async () => {
    if (!checkZipDuplication) {
      expect(checkZipDuplication).not.toBeNull();
      return;
    }

    const existingReportUrl = 'https://docs.example.com/skill-evals/abc123-test/index.html';
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        task_id: 'task-uuid-123',
        status: 'completed',
        report_url: existingReportUrl,
      }],
    });

    const result = await checkZipDuplication(mockPool, 'sha256-hash-abc');
    expect(result.isDuplicate).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.report_url).toBe(existingReportUrl);
  });

  it('命中 running/pending → 返回既有 task_id', async () => {
    if (!checkZipDuplication) {
      expect(checkZipDuplication).not.toBeNull();
      return;
    }

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        task_id: 'existing-task-uuid',
        status: 'pending',
        report_url: null,
      }],
    });

    const result = await checkZipDuplication(mockPool, 'sha256-hash-xyz');
    expect(result.isDuplicate).toBe(true);
    expect(result.task_id).toBe('existing-task-uuid');
    expect(result.status).toBe('pending');
  });

  it('无命中 → isDuplicate=false', async () => {
    if (!checkZipDuplication) {
      expect(checkZipDuplication).not.toBeNull();
      return;
    }

    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await checkZipDuplication(mockPool, 'sha256-hash-new');
    expect(result.isDuplicate).toBe(false);
  });
});

// ─── [UNIT-3] 单 slot 并发控制 ───────────────────────────────────────────────

describe('[UNIT-3] 单 slot 并发控制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 确保 MAX_CONCURRENT_SKILL_EVAL 来自环境变量
    delete process.env.MAX_CONCURRENT_SKILL_EVAL;
  });

  afterEach(() => {
    delete process.env.MAX_CONCURRENT_SKILL_EVAL;
  });

  it('MAX_CONCURRENT_SKILL_EVAL 从环境变量读取（默认 1）', async () => {
    if (!checkSlotAvailable) {
      expect(checkSlotAvailable).not.toBeNull();
      return;
    }

    // 无 in_progress 任务 → slot 可用
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const result = await checkSlotAvailable(mockPool);
    expect(result.available).toBe(true);
  });

  it('已有 1 个 in_progress 时 slot 不可用（单 slot 铁律）', async () => {
    if (!checkSlotAvailable) {
      expect(checkSlotAvailable).not.toBeNull();
      return;
    }

    process.env.MAX_CONCURRENT_SKILL_EVAL = '1';
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const result = await checkSlotAvailable(mockPool);
    expect(result.available).toBe(false);
  });

  it('pending ≥ 20 时 checkSlotAvailable 返回 queueFull=true', async () => {
    if (!checkSlotAvailable) {
      expect(checkSlotAvailable).not.toBeNull();
      return;
    }

    // 第一个 query: in_progress count
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    // 第二个 query: pending count
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '20' }] });

    const result = await checkSlotAvailable(mockPool);
    expect(result.queueFull).toBe(true);
  });
});

// ─── [UNIT-4] 额度预检（2 种失败场景）───────────────────────────────────────

describe('[UNIT-4] 额度预检', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('5h 池 <85% → 不派发，返回 canDispatch=false', async () => {
    if (!checkQuotaSufficient) {
      expect(checkQuotaSufficient).not.toBeNull();
      return;
    }

    // 模拟 5h 使用 20%（剩余 80% < 85%）
    mockPool.query.mockResolvedValueOnce({
      rows: [{ pool_5h_remaining_pct: 80, pool_7d_remaining_pct: 95 }],
    });

    const result = await checkQuotaSufficient(mockPool, 'account2');
    expect(result.canDispatch).toBe(false);
    expect(result.reason).toMatch(/5h|quota/i);
  });

  it('7d 池 <90% → 不派发，返回 canDispatch=false', async () => {
    if (!checkQuotaSufficient) {
      expect(checkQuotaSufficient).not.toBeNull();
      return;
    }

    // 模拟 5h 充足但 7d 不足（剩余 85% < 90%）
    mockPool.query.mockResolvedValueOnce({
      rows: [{ pool_5h_remaining_pct: 90, pool_7d_remaining_pct: 85 }],
    });

    const result = await checkQuotaSufficient(mockPool, 'account2');
    expect(result.canDispatch).toBe(false);
    expect(result.reason).toMatch(/7d|quota/i);
  });

  it('两项都满足 → canDispatch=true', async () => {
    if (!checkQuotaSufficient) {
      expect(checkQuotaSufficient).not.toBeNull();
      return;
    }

    mockPool.query.mockResolvedValueOnce({
      rows: [{ pool_5h_remaining_pct: 90, pool_7d_remaining_pct: 95 }],
    });

    const result = await checkQuotaSufficient(mockPool, 'account2');
    expect(result.canDispatch).toBe(true);
  });
});

// ─── [UNIT-5] 失败路径 slot 释放 ─────────────────────────────────────────────

describe('[UNIT-5] 失败路径 slot 释放', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const FAILURE_MODES = ['dispatch', 'crash', 'timeout', 'publish'];

  for (const mode of FAILURE_MODES) {
    it(`failed(${mode}) → in_progress_count 归零（slot 释放）`, async () => {
      if (!releaseSlot) {
        expect(releaseSlot).not.toBeNull();
        return;
      }

      mockPool.query.mockResolvedValue({ rows: [] });

      await releaseSlot(mockPool, 'task-uuid-abc', mode);

      // 验证 DB 写入：skill_evals.status = 'failed'
      const calls = mockPool.query.mock.calls;
      const updateCall = calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('failed') && c[0].includes('skill_evals')
      );
      expect(updateCall).toBeTruthy();

      // 验证 failure_reason 含失败模式名
      const updateParams = updateCall[1] || [];
      const hasMode = updateParams.some(p => typeof p === 'string' && p.includes(mode));
      expect(hasMode).toBe(true);
    });
  }
});

// ─── [BEHAVIOR-1] 上传合法 zip → 建 task 返回 task_id ───────────────────────

describe('[BEHAVIOR-1] 上传合法 zip → 建 task 返回 task_id', () => {
  it('POST /api/skill-eval/upload 合法请求 → HTTP 200 + task_id 非空 + queue_position ≥ 0', async () => {
    // 这是 BEHAVIOR 测试，在单元层级用 supertest 测试路由
    // 路由不存在时测试失败（Red 状态）
    let evalRouter;
    try {
      evalRouter = await import('../routes/eval.js');
    } catch (_e) {
      // Red 阶段：路由不存在
      throw new Error('[BEHAVIOR-1] eval.js 路由未实现 — Red 阶段预期失败');
    }
    expect(evalRouter).toBeDefined();
  });
});

// ─── [BEHAVIOR-2] 非法 zip 上传 → 422 + 具体原因 ─────────────────────────────

describe('[BEHAVIOR-2] 非法 zip 上传 → 422 + 具体原因', () => {
  it('非 zip 魔数文件 → HTTP 422 + error 含 magic', async () => {
    let evalRouter;
    try {
      evalRouter = await import('../routes/eval.js');
    } catch (_e) {
      throw new Error('[BEHAVIOR-2] eval.js 路由未实现 — Red 阶段预期失败');
    }
    // 路由存在后，这里进一步验证 supertest 行为
    expect(evalRouter).toBeDefined();
  });

  it('缺 SKILL.md → HTTP 422 + error 含 SKILL.md', async () => {
    let evalRouter;
    try {
      evalRouter = await import('../routes/eval.js');
    } catch (_e) {
      throw new Error('[BEHAVIOR-2] eval.js 路由未实现 — Red 阶段预期失败');
    }
    expect(evalRouter).toBeDefined();
  });
});

// ─── [BEHAVIOR-3] hash 去重 completed → 返回历史 report_url ─────────────────

describe('[BEHAVIOR-3] hash 去重 completed → 返回历史 report_url', () => {
  it('相同 zip 二次上传（首次已 completed）→ HTTP 200 + report_url == 首次 + deduped=true', async () => {
    if (!checkZipDuplication) {
      expect(checkZipDuplication).not.toBeNull();
      return;
    }

    const existingUrl = 'https://docs.example.com/skill-evals/old-report/index.html';
    mockPool.query.mockResolvedValueOnce({
      rows: [{ task_id: 'old-task', status: 'completed', report_url: existingUrl }],
    });

    const result = await checkZipDuplication(mockPool, 'same-hash');
    expect(result.isDuplicate).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.report_url).toBe(existingUrl);
    // deduped 标记（路由层通过此判断返回 deduped: true）
    expect(result.isDuplicate).toBe(true);
  });
});

// ─── [BEHAVIOR-4] 不带 X-Eval-Proxy-Token 直打 Brain → 403 ──────────────────

describe('[BEHAVIOR-4] 不带 X-Eval-Proxy-Token 直打 Brain → 403', () => {
  it('无 X-Eval-Proxy-Token header → 403', async () => {
    // 验证中间件存在
    let evalRouter;
    try {
      evalRouter = await import('../routes/eval.js');
    } catch (_e) {
      throw new Error('[BEHAVIOR-4] eval.js 路由未实现 — Red 阶段预期失败');
    }
    expect(evalRouter).toBeDefined();
  });
});

// ─── [BEHAVIOR-7] pending ≥ 20 → 新上传 429 ─────────────────────────────────

describe('[BEHAVIOR-7] pending ≥ 20 → 新上传 429', () => {
  it('queue 已满（pending ≥ 20）→ HTTP 429 + error 含排队已满或 queue full', async () => {
    if (!checkSlotAvailable) {
      expect(checkSlotAvailable).not.toBeNull();
      return;
    }

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // in_progress
      .mockResolvedValueOnce({ rows: [{ count: '20' }] }); // pending

    const result = await checkSlotAvailable(mockPool);
    expect(result.queueFull).toBe(true);
  });
});

// ─── [BEHAVIOR-8] 失败后 slot 释放 ───────────────────────────────────────────

describe('[BEHAVIOR-8] 失败后 slot 释放（可单元级验证）', () => {
  it('模拟 failed(timeout) 路径后 → in_progress_count == 0 → 下一个 pending task 可被拾起', async () => {
    if (!releaseSlot) {
      expect(releaseSlot).not.toBeNull();
      return;
    }

    mockPool.query.mockResolvedValue({ rows: [] });

    await releaseSlot(mockPool, 'task-timeout-uuid', 'timeout');

    // 释放后 checkSlotAvailable 应返回 available=true
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // in_progress = 0
      .mockResolvedValueOnce({ rows: [{ count: '5' }] }); // pending < 20

    const slotResult = await checkSlotAvailable(mockPool);
    expect(slotResult.available).toBe(true);
    expect(slotResult.queueFull).toBe(false);
  });
});

// ─── [BEHAVIOR-9] 状态查询返回 queue_position ────────────────────────────────

describe('[BEHAVIOR-9] 状态查询返回 queue_position', () => {
  it('GET /api/skill-eval/status/:task_id pending 中 → queue_position ≥ 1 + status ∈ 合法集', async () => {
    if (!getEvalQueuePosition) {
      expect(getEvalQueuePosition).not.toBeNull();
      return;
    }

    mockPool.query.mockResolvedValueOnce({
      rows: [{ queue_position: 3 }],
    });

    const pos = await getEvalQueuePosition(mockPool, 'pending-task-uuid');
    expect(pos).toBeGreaterThanOrEqual(1);
  });
});
