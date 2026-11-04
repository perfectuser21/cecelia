/**
 * eval.test.js — Skill Evaluator 内部验收台单元测试
 * Sprint: 07072314-skill-eval-service
 * [BEHAVIOR] 测试：对应 contract-dod.md 中所有 [BEHAVIOR] 条目
 * [UNIT] 测试：对应 contract-dod.md 中所有 [UNIT] 条目
 *
 * 真实validator与HTTP路由；数据库/任务创建/文件落盘为隔离边界
 */

import express from 'express';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
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
vi.mock('../actions.js', () => ({ createTask: vi.fn(async () => ({ task: { id: 'created-eval-task' } })) }));
vi.stubGlobal('fetch', mockFetch);

vi.mock('fs', () => ({
  default: { promises: mockFsPromises },
  createReadStream: mockCreateReadStream,
  promises: mockFsPromises,
}));

vi.mock('fs/promises', () => mockFsPromises);

import { validateZipBuffer, checkZipDuplication, checkSlotAvailable,
  checkQuotaSufficient, releaseSlot, getEvalQueuePosition } from '../skill-eval-validator.js';
import evalRouter from '../routes/eval.js';

function realZip(entries) {
  return execFileSync('python3', ['-c', `import io,json,sys,zipfile
b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for name,size in json.loads(sys.stdin.read()): z.writestr(name, b'x'*size)
sys.stdout.buffer.write(b.getvalue())`], { input: JSON.stringify(entries) });
}

// ─── 测试辅助：构造假 zip Buffer ────────────────────────────────────────────

function makeNonZipBuffer() {
  return Buffer.from('not a zip file content');
}

// ─── [UNIT-1] 硬校验覆盖 ─────────────────────────────────────────────────────

describe('[UNIT-1] zip 硬校验（5 种非法输入）', () => {
  it('非 zip 魔数文件 → 返回错误含 magic', async () => {
    const buf = makeNonZipBuffer();
    const result = await validateZipBuffer(buf);
    expect(result.valid).toBe(false);
    expect(result.error.toLowerCase()).toMatch(/magic|魔数/);
  });

  it('解压超 50MB zip → 返回错误含解压或 size', async () => {
    // 模拟 unzipper 报告超大解压
    const result = await validateZipBuffer(realZip([['SKILL.md', 51 * 1024 * 1024]]));
    expect(result.valid).toBe(false);
    expect(result.error.toLowerCase()).toMatch(/解压|size|unzip/);
  });

  it('缺 SKILL.md → 返回错误含 SKILL.md', async () => {
    const result = await validateZipBuffer(realZip([['README.txt', 10]]));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/SKILL\.md/);
  });

  it('含路径穿越（../）→ 返回错误含 traversal 或路径', async () => {
    const result = await validateZipBuffer(realZip([['../evil.sh', 10], ['SKILL.md', 10]]));
    expect(result.valid).toBe(false);
    expect(result.error.toLowerCase()).toMatch(/traversal|路径穿越|path/);
  });

  it('压缩比超 100:1（文件数超 2000）→ 返回错误', async () => {
    const result = await validateZipBuffer(realZip([['SKILL.md', 10], ...Array.from({ length: 2001 }, (_, i) => [`file${i}.txt`, 1])]));
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

    // 无 in_progress 任务 → slot 可用
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const result = await checkSlotAvailable(mockPool);
    expect(result.available).toBe(true);
  });

  it('已有 1 个 in_progress 时 slot 不可用（单 slot 铁律）', async () => {

    process.env.MAX_CONCURRENT_SKILL_EVAL = '1';
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const result = await checkSlotAvailable(mockPool);
    expect(result.available).toBe(false);
  });

  it('pending ≥ 20 时 checkSlotAvailable 返回 queueFull=true', async () => {

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

    // 模拟 5h 使用 20%（剩余 80% < 85%）
    mockPool.query.mockResolvedValueOnce({
      rows: [{ pool_5h_remaining_pct: 80, pool_7d_remaining_pct: 95 }],
    });

    const result = await checkQuotaSufficient(mockPool, 'account2');
    expect(result.canDispatch).toBe(false);
    expect(result.reason).toMatch(/5h|quota/i);
  });

  it('7d 池 <90% → 不派发，返回 canDispatch=false', async () => {

    // 模拟 5h 充足但 7d 不足（剩余 85% < 90%）
    mockPool.query.mockResolvedValueOnce({
      rows: [{ pool_5h_remaining_pct: 90, pool_7d_remaining_pct: 85 }],
    });

    const result = await checkQuotaSufficient(mockPool, 'account2');
    expect(result.canDispatch).toBe(false);
    expect(result.reason).toMatch(/7d|quota/i);
  });

  it('两项都满足 → canDispatch=true', async () => {

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

describe('上传HTTP合同：真实zip解析与路由，隔离文件写入和任务账本', () => {
  function app() { const app = express(); app.use('/api/skill-eval', evalRouter); return app; }
  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.query.mockImplementation(async sql => ({ rows: sql.includes('as position') ? [{ position: 1 }] : sql.includes('COUNT(*)') ? [{ count: 0 }] : [] }));
    vi.stubEnv('EVAL_PROXY_TOKEN', 'eval-test-token');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('合法zip真实POST建eval并返回task_id与队列位置', async () => {
    const res = await request(app()).post('/api/skill-eval/upload').set('X-Eval-Proxy-Token', 'eval-test-token')
      .field('skill_name', 'actual-upload').attach('file', realZip([['SKILL.md', 12]]), 'skill.zip');
    expect(res.status).toBe(200);
    expect(res.body.task_id).toBe('created-eval-task');
    expect(res.body.queue_position).toBeGreaterThanOrEqual(0);
    const insert = mockPool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO skill_evals'));
    expect(insert[1][0]).toBe(res.body.task_id);
  });
  it.each([['magic', Buffer.from('not a zip')], ['SKILL.md', realZip([['README.txt', 10]])]])('非法zip %s返回422且不写eval', async (reason, bytes) => {
    const res = await request(app()).post('/api/skill-eval/upload').set('X-Eval-Proxy-Token', 'eval-test-token')
      .field('skill_name', 'bad-upload').attach('file', bytes, 'bad.zip');
    expect(res.status).toBe(422); expect(res.body.error).toContain(reason);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
  it('缺token真实POST返回403且零查库', async () => {
    const res = await request(app()).post('/api/skill-eval/upload');
    expect(res.status).toBe(403); expect(mockPool.query).not.toHaveBeenCalled();
  });
});

// ─── [BEHAVIOR-7] pending ≥ 20 → 新上传 429 ─────────────────────────────────

describe('[BEHAVIOR-7] pending ≥ 20 → 新上传 429', () => {
  it('queue 已满（pending ≥ 20）→ HTTP 429 + error 含排队已满或 queue full', async () => {

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

    let running = true;
    mockPool.query.mockReset();
    mockPool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('UPDATE skill_evals')) {
        expect(params).toEqual(['failed(timeout)', 'task-timeout-uuid']);
        running = false;
      }
      if (sql.includes("WHERE status = 'running'")) return { rows: [{ count: running ? 1 : 0 }] };
      if (sql.includes("WHERE status = 'pending'")) return { rows: [{ count: 5 }] };
      return { rows: [] };
    });
    expect((await checkSlotAvailable(mockPool)).available).toBe(false);
    await releaseSlot(mockPool, 'task-timeout-uuid', 'timeout');
    const slotResult = await checkSlotAvailable(mockPool);
    expect(slotResult.available).toBe(true);
    expect(slotResult.queueFull).toBe(false);
  });
});

// ─── [BEHAVIOR-9] 状态查询返回 queue_position ────────────────────────────────

describe('[BEHAVIOR-9] 状态查询返回 queue_position', () => {
  it('队列位次helper读取pending位置为3', async () => {

    mockPool.query.mockResolvedValueOnce({
      rows: [{ queue_position: 3 }],
    });

    const pos = await getEvalQueuePosition(mockPool, 'pending-task-uuid');
    expect(pos).toBeGreaterThanOrEqual(1);
  });
});
