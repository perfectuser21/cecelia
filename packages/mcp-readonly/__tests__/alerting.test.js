import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlertTracker } from '../src/alerting.js';

describe('AlertTracker', () => {
  let sendBark;
  let tracker;
  const nowRef = { value: 1_000_000 };

  beforeEach(() => {
    sendBark = vi.fn().mockResolvedValue(undefined);
    tracker = new AlertTracker({ sendBark, now: () => nowRef.value });
  });

  it('5分钟内同token鉴权失败达到10次触发Bark', async () => {
    for (let i = 0; i < 9; i++) await tracker.recordAuthFailure('token-a');
    expect(sendBark).not.toHaveBeenCalled();
    await tracker.recordAuthFailure('token-a');
    expect(sendBark).toHaveBeenCalledOnce();
    expect(sendBark.mock.calls[0][0]).toContain('鉴权失败');
  });

  it('连续3次DB连接失败触发Bark', async () => {
    await tracker.recordDbFailure();
    await tracker.recordDbFailure();
    expect(sendBark).not.toHaveBeenCalled();
    await tracker.recordDbFailure();
    expect(sendBark).toHaveBeenCalledOnce();
  });

  it('DB失败中间穿插一次成功会重置计数', async () => {
    await tracker.recordDbFailure();
    await tracker.recordDbFailure();
    tracker.recordDbSuccess();
    await tracker.recordDbFailure();
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('1小时内重启超过3次触发Bark', async () => {
    await tracker.recordRestart();
    await tracker.recordRestart();
    await tracker.recordRestart();
    expect(sendBark).not.toHaveBeenCalled();
    await tracker.recordRestart();
    expect(sendBark).toHaveBeenCalledOnce();
  });

  it('10分钟内同token触发限流超过5次触发Bark', async () => {
    for (let i = 0; i < 5; i++) await tracker.recordRateLimited('token-b');
    expect(sendBark).not.toHaveBeenCalled();
    await tracker.recordRateLimited('token-b');
    expect(sendBark).toHaveBeenCalledOnce();
  });

  // Task 6 定过规矩：拿 token 做 key/分桶一律 hash，不留明文（见
  // packages/mcp-readonly/src/rate-limit.js 的 rateLimitKeyGenerator +
  // commit a3d9385d09"限流 key 改用 sha256 hash 防 debug 日志泄露明文 token"）。
  // AlertTracker 内部的 authFailures/rateLimited 是同一类"按 token 分桶计数"的
  // Map，同样的风险场景（这两个 Map 本身可能被 debug 日志/内存快照工具输出），
  // 所以这里断言：Map 的 key 不是明文 token，且发给 Bark 的消息文本里也不会
  // 出现完整 token（只允许出现帮助人工定位的末 4 位）。
  it('鉴权失败计数不以明文token做Map key，Bark消息也不含完整token', async () => {
    const secretToken = 'super-secret-token-should-not-leak-1234';
    for (let i = 0; i < 10; i++) await tracker.recordAuthFailure(secretToken);

    expect(tracker.authFailures.has(secretToken)).toBe(false);
    for (const key of tracker.authFailures.keys()) {
      expect(key).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    }

    expect(sendBark).toHaveBeenCalledOnce();
    const message = sendBark.mock.calls[0][0];
    expect(message).not.toContain(secretToken);
    expect(message).toContain(secretToken.slice(-4));
  });

  it('限流触发计数不以明文token做Map key，Bark消息也不含完整token', async () => {
    const secretToken = 'another-secret-token-for-ratelimit-9876';
    for (let i = 0; i < 6; i++) await tracker.recordRateLimited(secretToken);

    expect(tracker.rateLimited.has(secretToken)).toBe(false);
    for (const key of tracker.rateLimited.keys()) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }

    expect(sendBark).toHaveBeenCalledOnce();
    const message = sendBark.mock.calls[0][0];
    expect(message).not.toContain(secretToken);
    expect(message).toContain(secretToken.slice(-4));
  });
});

// recordRestart() 是纯内存态：AlertTracker 每次进程启动都会被重新 new 一次，
// 内存必然清零，"1小时内重启>3次"这种跨进程崩溃循环永远数不到。
// recordRestartPersisted() 把计数落到磁盘文件（时间戳数组），每次“进程启动”
// 各自用一个全新的 AlertTracker 实例调用一次，模拟真实的多进程场景。
describe('AlertTracker.recordRestartPersisted（跨进程持久化）', () => {
  let tmpDir;
  let filePath;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcp-readonly-alert-'));
    filePath = join(tmpDir, 'restart-history.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('文件不存在时当作零历史，不报错', async () => {
    const sendBark = vi.fn().mockResolvedValue(undefined);
    const tracker = new AlertTracker({ sendBark, now: () => 1_000_000 });
    await expect(tracker.recordRestartPersisted(filePath)).resolves.not.toThrow();
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('模拟4次独立进程重启（每次全新tracker+同一文件），第4次触发Bark', async () => {
    const sendBark = vi.fn().mockResolvedValue(undefined);

    for (let i = 0; i < 3; i++) {
      const t = new AlertTracker({ sendBark, now: () => 1_000_000 + i * 1000 });
      await t.recordRestartPersisted(filePath);
    }
    expect(sendBark).not.toHaveBeenCalled();

    const t4 = new AlertTracker({ sendBark, now: () => 1_000_000 + 3000 });
    await t4.recordRestartPersisted(filePath);

    expect(sendBark).toHaveBeenCalledOnce();
    expect(sendBark.mock.calls[0][0]).toContain('重启风暴');
  });

  it('触发后清空持久化文件，避免下一次启动立刻再触发', async () => {
    const sendBark = vi.fn().mockResolvedValue(undefined);

    for (let i = 0; i < 4; i++) {
      const t = new AlertTracker({ sendBark, now: () => 1_000_000 + i * 1000 });
      await t.recordRestartPersisted(filePath);
    }
    expect(sendBark).toHaveBeenCalledOnce();

    const raw = await readFile(filePath, 'utf-8');
    expect(JSON.parse(raw)).toEqual([]);
  });

  it('超过1小时的旧重启记录不计入窗口', async () => {
    const sendBark = vi.fn().mockResolvedValue(undefined);
    const ONE_HOUR = 60 * 60 * 1000;

    // 三次"很久以前"的重启
    for (let i = 0; i < 3; i++) {
      const t = new AlertTracker({ sendBark, now: () => 1_000_000 + i * 1000 });
      await t.recordRestartPersisted(filePath);
    }

    // 两个多小时后又重启一次：旧的三条应该被剪掉，不会跟这次凑够4次触发
    const later = new AlertTracker({
      sendBark,
      now: () => 1_000_000 + 3000 + ONE_HOUR * 2,
    });
    await later.recordRestartPersisted(filePath);

    expect(sendBark).not.toHaveBeenCalled();
  });
});
