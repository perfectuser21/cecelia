/**
 * callback-dlq.test.js
 *
 * 验证行为：DB INSERT 全部失败时，writeDockerCallback 写 DLQ 文件。
 * DLQ 文件需包含 task_id / stdout / exit_code / timestamp 字段。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../packages/brain/src/db.js', () => ({ default: { query: mockQuery } }));

vi.mock('../../packages/brain/src/spawn/middleware/docker-run.js', () => ({ runDocker: vi.fn() }));
vi.mock('../../packages/brain/src/spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../../packages/brain/src/spawn/middleware/cascade.js', () => ({ resolveCascade: vi.fn() }));
vi.mock('../../packages/brain/src/spawn/middleware/cost-cap.js', () => ({ checkCostCap: vi.fn() }));
vi.mock('../../packages/brain/src/spawn/middleware/cap-marking.js', () => ({ checkCap: vi.fn() }));
vi.mock('../../packages/brain/src/spawn/middleware/billing.js', () => ({ recordBilling: vi.fn() }));
vi.mock('../../packages/brain/src/spawn/middleware/logging.js', () => ({ createSpawnLogger: vi.fn(() => ({ log: vi.fn(), end: vi.fn() })) }));

let writeDockerCallback;
let dlqDir;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  dlqDir = path.join(os.tmpdir(), `test-dlq-${process.hrtime.bigint()}`);
  process.env.CECELIA_CALLBACK_DLQ_DIR = dlqDir;
  const mod = await import('../../packages/brain/src/docker-executor.js');
  writeDockerCallback = mod.writeDockerCallback;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CECELIA_CALLBACK_DLQ_DIR;
  if (existsSync(dlqDir)) rmSync(dlqDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

const TASK = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', task_type: 'dev' };
const RESULT = {
  stdout: 'some agent output',
  stderr: null,
  exit_code: 1,
  timed_out: false,
  duration_ms: 1200,
  container: 'test-container',
  started_at: new Date().toISOString(),
  ended_at: new Date().toISOString(),
};

describe('writeDockerCallback — DB 全失败走 DLQ', () => {
  it('INSERT 失败 4 次后，DLQ 文件存在且含正确字段', async () => {
    mockQuery.mockRejectedValue(new Error('DB connection refused'));

    const promise = writeDockerCallback(TASK, 'run-1', null, RESULT);
    const guarded = promise.catch(() => {});
    await vi.runAllTimersAsync();
    await guarded;
    await expect(promise).rejects.toThrow('DB connection refused');

    expect(mockQuery).toHaveBeenCalledTimes(4);

    const dlqFile = path.join(dlqDir, `${TASK.id}.json`);
    expect(existsSync(dlqFile)).toBe(true);

    const payload = JSON.parse(readFileSync(dlqFile, 'utf8'));
    expect(payload.task_id).toBe(TASK.id);
    expect(payload.stdout).toBe('some agent output');
    expect(payload.exit_code).toBe(1);
    expect(typeof payload.timestamp).toBe('string');
    expect(payload.error).toMatch(/DB connection refused/);
  });

  it('INSERT 第一次就成功 — 不写 DLQ', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const task2 = { id: 'ffffffff-0000-1111-2222-333333333333', task_type: 'dev' };
    await expect(writeDockerCallback(task2, 'run-2', null, { ...RESULT, exit_code: 0 })).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(existsSync(dlqDir)).toBe(false);
  });

  it('INSERT 第 3 次重试成功 — 不写 DLQ', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ rows: [] });

    const task3 = { id: '11111111-2222-3333-4444-555555555555', task_type: 'dev' };
    const promise = writeDockerCallback(task3, 'run-3', null, { ...RESULT, exit_code: 0 });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(existsSync(dlqDir)).toBe(false);
  });
});
