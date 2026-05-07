/**
 * docker-executor.test.js — 验证 Docker Sandbox 执行器
 *
 * 覆盖：
 *  1. resolveResourceTier — task_type → 资源档位映射
 *  2. containerName — 短 ID 生成
 *  3. envToArgs — env 对象转 docker -e 参数
 *  4. writePromptFile — 写临时 prompt 文件
 *  5. executeInDocker — 输入校验
 *  6. writeDockerCallback — INSERT callback_queue 字段映射
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';

// Mock pool — hoisted
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const {
  executeInDocker,
  writeDockerCallback,
  resolveResourceTier,
  __test__,
} = await import('../docker-executor.js');

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue({ rowCount: 1 });
});

describe('resolveResourceTier', () => {
  it('dev → heavy (1.5 GB / 2 cores)', () => {
    const r = resolveResourceTier('dev');
    expect(r.tier).toBe('heavy');
    expect(r.memoryMB).toBe(1536);
    expect(r.cpuCores).toBe(2);
  });

  it('planner → light (512 MB / 1 core)', () => {
    const r = resolveResourceTier('planner');
    expect(r.tier).toBe('light');
    expect(r.memoryMB).toBe(512);
    expect(r.cpuCores).toBe(1);
  });

  it('未知 task_type → normal (1 GB / 1 core)', () => {
    const r = resolveResourceTier('something_unknown');
    expect(r.tier).toBe('normal');
    expect(r.memoryMB).toBe(1024);
    expect(r.cpuCores).toBe(1);
  });

  it('harness_generator → heavy', () => {
    expect(resolveResourceTier('harness_generator').tier).toBe('heavy');
  });

  it('harness_planner → light', () => {
    expect(resolveResourceTier('harness_planner').tier).toBe('light');
  });
});

describe('containerName', () => {
  it('生成 cecelia-task-{12 字符短 ID}', () => {
    const name = __test__.containerName('39c1c97e-4fbf-46bf-a686-cdac9c40c3c8');
    expect(name).toBe('cecelia-task-39c1c97e4fbf');
    expect(name.length).toBeLessThanOrEqual(63); // docker name 限制
  });

  it('短 task_id 也安全（不会越界）', () => {
    expect(__test__.containerName('abc')).toBe('cecelia-task-abc');
  });
});

describe('envToArgs', () => {
  it('对象转 -e KEY=VALUE 列表', () => {
    const args = __test__.envToArgs({ FOO: 'bar', N: 1 });
    expect(args).toEqual(['-e', 'FOO=bar', '-e', 'N=1']);
  });

  it('null/undefined 值跳过', () => {
    const args = __test__.envToArgs({ A: 'x', B: null, C: undefined });
    expect(args).toEqual(['-e', 'A=x']);
  });

  it('空对象返回 []', () => {
    expect(__test__.envToArgs({})).toEqual([]);
    expect(__test__.envToArgs(null)).toEqual([]);
  });
});

describe('writePromptFile', () => {
  it('写入文件并返回路径', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'cecelia-prompt-test-'));
    const oldEnv = process.env.CECELIA_PROMPT_DIR;
    process.env.CECELIA_PROMPT_DIR = tmpDir;
    try {
      // re-import 不便，直接调用 __test__.writePromptFile（与生产路径一致，
      // 但内部 DEFAULT_PROMPT_DIR 已在 import 时锁定，不会变化）
      // 为确保测试，单独走 fs 验证
      const { writePromptFile } = __test__;
      const file = writePromptFile('test-task-id', 'hello prompt');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('hello prompt');
    } finally {
      if (oldEnv === undefined) delete process.env.CECELIA_PROMPT_DIR;
      else process.env.CECELIA_PROMPT_DIR = oldEnv;
    }
  });
});

describe('executeInDocker — 输入校验', () => {
  it('缺 task.id 抛错', async () => {
    await expect(executeInDocker({ prompt: 'x' })).rejects.toThrow(/task\.id/);
  });

  it('缺 prompt 抛错', async () => {
    await expect(
      executeInDocker({ task: { id: 'abc' } })
    ).rejects.toThrow(/prompt/);
  });

  it('空 prompt 抛错', async () => {
    await expect(
      executeInDocker({ task: { id: 'abc' }, prompt: '' })
    ).rejects.toThrow(/prompt/);
  });
});

describe('writeDockerCallback — INSERT callback_queue', () => {
  const baseTask = { id: '11111111-2222-3333-4444-555555555555', task_type: 'dev' };

  it('exit_code=0 → status=success', async () => {
    await writeDockerCallback(baseTask, 'run-1', 'cp-abc', {
      exit_code: 0,
      stdout: 'ok',
      stderr: '',
      duration_ms: 1234,
      container: 'cecelia-task-xxx',
      timed_out: false,
      started_at: '2026-04-13T22:00:00Z',
      ended_at: '2026-04-13T22:00:01Z',
    });
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO callback_queue/);
    expect(params[0]).toBe(baseTask.id);
    expect(params[3]).toBe('success');
    expect(params[8]).toBe(0); // exit_code
    expect(params[9]).toBeNull(); // failure_class
    const resultJson = JSON.parse(params[4]);
    expect(resultJson.docker).toBe(true);
    expect(resultJson._meta.executor).toBe('docker');
    expect(resultJson._meta.tier).toBe('heavy'); // dev
  });

  it('timed_out=true → status=timeout / failure_class=docker_timeout', async () => {
    await writeDockerCallback(baseTask, 'run-2', null, {
      exit_code: -1,
      stdout: '',
      stderr: 'killed',
      duration_ms: 900000,
      container: 'cecelia-task-yyy',
      timed_out: true,
      started_at: '2026-04-13T22:00:00Z',
      ended_at: '2026-04-13T22:15:00Z',
    });
    const [, params] = mockPool.query.mock.calls[0];
    expect(params[3]).toBe('timeout');
    expect(params[9]).toBe('docker_timeout');
  });

  it('exit_code != 0 且非 OOM 且未超时 → status=failed / failure_class=docker_nonzero_exit', async () => {
    // exit_code=1 = generic 非零退出（npm test fail / lint fail 等）
    // exit_code=137 是 SIGKILL/OOM，由 docker-executor-oom-alert.test.js 单独覆盖（PR #2805）
    await writeDockerCallback(baseTask, 'run-3', 'cp-z', {
      exit_code: 1,
      stdout: '',
      stderr: 'generic non-zero error',
      duration_ms: 5000,
      container: 'cecelia-task-zzz',
      timed_out: false,
      started_at: '2026-04-13T22:00:00Z',
      ended_at: '2026-04-13T22:00:05Z',
    });
    const [, params] = mockPool.query.mock.calls[0];
    expect(params[3]).toBe('failed');
    expect(params[8]).toBe(1);
    expect(params[9]).toBe('docker_nonzero_exit');
  });

  it('parses pr_url and verdict from stdout JSON result into _meta', async () => {
    // claude --output-format json 末尾产出 {"type":"result","result":"<inner>"},
    // inner 是 SKILL.md 约定的纯 JSON `{"verdict":"DONE","pr_url":"..."}`
    const inner = '{"verdict":"DONE","pr_url":"https://github.com/perfectuser21/cecelia/pull/42"}';
    const stdout = JSON.stringify({ type: 'result', result: inner });
    await writeDockerCallback(baseTask, 'run-4', null, {
      exit_code: 0,
      stdout,
      stderr: '',
      duration_ms: 1000,
      container: 'cecelia-task-aaa',
      timed_out: false,
      started_at: '2026-04-25T00:00:00Z',
      ended_at: '2026-04-25T00:00:01Z',
    });
    const [, params] = mockPool.query.mock.calls[0];
    const resultJson = JSON.parse(params[4]);
    expect(resultJson._meta.pr_url).toBe('https://github.com/perfectuser21/cecelia/pull/42');
    expect(resultJson._meta.verdict).toBe('DONE');
  });

  it('sets _meta.pr_url=null / _meta.verdict=null when stdout lacks them', async () => {
    await writeDockerCallback(baseTask, 'run-5', null, {
      exit_code: 0,
      stdout: 'plain log line, no json',
      stderr: '',
      duration_ms: 1000,
      container: 'cecelia-task-bbb',
      timed_out: false,
      started_at: '2026-04-25T00:00:00Z',
      ended_at: '2026-04-25T00:00:01Z',
    });
    const [, params] = mockPool.query.mock.calls[0];
    const resultJson = JSON.parse(params[4]);
    expect(resultJson._meta.pr_url).toBeNull();
    expect(resultJson._meta.verdict).toBeNull();
  });
});
