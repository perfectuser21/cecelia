/**
 * docker-executor-metadata.test.js — WF-3 观察性
 *
 * 覆盖 executeInDocker 返回值的新字段：
 *   - exit_code            已有 → 保持
 *   - duration_ms          已有 → 保持
 *   - stderr               已有 → 保持
 *   - container            已有（container 名） → 保持
 *   - container_id         新：容器 ID 前 12 位（从 --cidfile 读）
 *   - command              新：完整 docker run 命令字符串
 *   - prompt_sent / raw_stdout / raw_stderr  — 这几个属"调用方 clip 之后的产物"，
 *     由 content-pipeline-graph.js::runDockerNode 处理，本测试只管 executor 返回的原始字段。
 *
 * 策略：mock child_process.spawn 产出可控 stdout/stderr/exit_code，
 * 用 fs mock 让 cidfile 读到假的 container id 字符串。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

// Mock DB pool 以免触 Postgres
const mockPool = vi.hoisted(() => ({ query: vi.fn().mockResolvedValue({ rowCount: 1 }) }));
vi.mock('../db.js', () => ({ default: mockPool }));

// Mock child_process.spawn 模拟 docker 子进程
const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: mockSpawn }));

// 准备临时 prompt dir（executor 会 mkdirSync + writeFileSync prompt 文件 + --cidfile）
let tmpDir;
beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'cecelia-docker-exec-meta-'));
  process.env.CECELIA_PROMPT_DIR = tmpDir;
  mockSpawn.mockReset();
});
afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.CECELIA_PROMPT_DIR;
});

/**
 * 帮助：造一个 fake docker proc，exit 时返回 code。
 * 可选 stdoutChunks / stderrChunks 写入流。
 * 可选 cidToWrite：docker 启动后会把 container ID 写进 --cidfile；
 *   我们在 proc 启动后立即把它写入对应文件。
 */
function makeFakeDockerProc({ stdout = '', stderr = '', code = 0, cidToWrite, cidfilePath }) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  // 模拟：在 microtask 里发数据 + exit
  queueMicrotask(() => {
    if (cidToWrite && cidfilePath) {
      try { writeFileSync(cidfilePath, cidToWrite, 'utf8'); } catch { /* ignore */ }
    }
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('exit', code, null);
  });
  return proc;
}

describe('executeInDocker — WF-3 观察性元数据', () => {
  // 每个 it 需要 dynamic import（不然 DEFAULT_PROMPT_DIR 锁在 module load 时，我们调 env 后才生效）
  async function loadExecutor() {
    vi.resetModules();
    return await import('../docker-executor.js');
  }

  it('成功路径：container_id 从 --cidfile 读取（前 12 位），command 字段完整', async () => {
    const { executeInDocker, __test__ } = await loadExecutor();
    const taskId = 'task-meta-1';
    const cidfilePath = __test__.cidFilePath(taskId);
    const fakeFullId = 'abcdef0123456789fedcba9876543210fedcba9876543210fedcba9876543210';

    mockSpawn.mockImplementation((cmd, args) => {
      // 校验：args 里应该有 --cidfile 参数
      expect(cmd).toBe('docker');
      expect(args).toContain('--cidfile');
      // docker run 时模拟写 cidfile
      return makeFakeDockerProc({
        stdout: 'hello\n{"result":"ok"}\n',
        stderr: 'some warning',
        code: 0,
        cidToWrite: fakeFullId,
        cidfilePath,
      });
    });

    const result = await executeInDocker({
      task: { id: taskId, task_type: 'planner' },
      prompt: 'do something',
    });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.stderr).toBe('some warning');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.container).toMatch(/^cecelia-task-/);
    // 新字段
    expect(result.container_id).toBe(fakeFullId.slice(0, 12));
    expect(typeof result.command).toBe('string');
    expect(result.command.startsWith('docker run')).toBe(true);
    expect(result.command).toContain('--cidfile');
    expect(result.command).toContain(result.container);
  });

  it('失败路径（非 OOM）：非零 exit_code 时 container_id 仍能读到（cidfile 未清理前读）', async () => {
    const { executeInDocker, __test__ } = await loadExecutor();
    const taskId = 'task-meta-fail';
    const cidfilePath = __test__.cidFilePath(taskId);
    const fakeId = '0011223344556677';

    // exit=1 是一般容器内业务失败，不是 OOM/SIGKILL，仍走 resolve 路径。
    // 137/SIGKILL 在 Harness W6 后改走 reject — 由下面单独 case 覆盖。
    mockSpawn.mockImplementation(() =>
      makeFakeDockerProc({
        stdout: '',
        stderr: 'task failed',
        code: 1,
        cidToWrite: fakeId,
        cidfilePath,
      })
    );

    const result = await executeInDocker({
      task: { id: taskId, task_type: 'dev' },
      prompt: 'x',
    });

    expect(result.exit_code).toBe(1);
    expect(result.container_id).toBe('001122334455');
    expect(result.stderr).toBe('task failed');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('Harness W6: OOM (exit=137) reject 时 error 上仍带 container_id 用于 forensic', async () => {
    const { executeInDocker, __test__ } = await loadExecutor();
    const taskId = 'task-meta-oom';
    const cidfilePath = __test__.cidFilePath(taskId);
    const fakeId = 'aabbccddeeff0011';

    mockSpawn.mockImplementation(() =>
      makeFakeDockerProc({
        stdout: '',
        stderr: 'OOM killed',
        code: 137,
        cidToWrite: fakeId,
        cidfilePath,
      })
    );

    const err = await executeInDocker({
      task: { id: taskId, task_type: 'dev' },
      prompt: 'x',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('OOM_KILLED');
    expect(err.exit_code).toBe(137);
    expect(err.container_id).toBe('aabbccddeeff'); // 前 12 位，cidfile 在 reject 前读
    expect(err.stderr).toBe('OOM killed');
  });

  it('cidfile 未写入（docker 启动失败）时 container_id 返回 null', async () => {
    const { executeInDocker } = await loadExecutor();
    mockSpawn.mockImplementation(() =>
      makeFakeDockerProc({
        stdout: '',
        stderr: 'image not found',
        code: 125,
        // 不写 cidfile
      })
    );

    const result = await executeInDocker({
      task: { id: 'task-meta-no-cid', task_type: 'planner' },
      prompt: 'x',
    });

    expect(result.exit_code).toBe(125);
    expect(result.container_id).toBeNull();
    expect(result.command).toContain('--cidfile');
  });

  it('残留 cidfile 会被清理再 run（否则 docker 会立即失败）', async () => {
    const { existsSync } = await import('fs');
    const { executeInDocker, __test__ } = await loadExecutor();
    const taskId = 'task-meta-stale';
    const cidfilePath = __test__.cidFilePath(taskId);
    // 预先写一个残留文件
    writeFileSync(cidfilePath, 'old-container-id', 'utf8');
    expect(existsSync(cidfilePath)).toBe(true);

    let spawnCalled = false;
    mockSpawn.mockImplementation(() => {
      // executor 已经在 spawn 前删除 cidfile
      expect(existsSync(cidfilePath)).toBe(false);
      spawnCalled = true;
      return makeFakeDockerProc({ stdout: '', stderr: '', code: 0 });
    });

    await executeInDocker({
      task: { id: taskId, task_type: 'planner' },
      prompt: 'x',
    });
    expect(spawnCalled).toBe(true);
  });

  it('spawn error 时 command 字段仍然完整（forensic 价值）', async () => {
    const { executeInDocker } = await loadExecutor();
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      queueMicrotask(() => proc.emit('error', new Error('ENOENT: docker binary not found')));
      return proc;
    });

    const result = await executeInDocker({
      task: { id: 'task-meta-err', task_type: 'planner' },
      prompt: 'x',
    });
    expect(result.exit_code).toBe(-1);
    expect(result.container_id).toBeNull();
    expect(result.command).toContain('docker run');
    expect(result.stderr).toContain('spawn error');
  });
});

describe('readContainerIdFromCidfile 行为', () => {
  it('文件不存在返回 null', async () => {
    const { __test__ } = await import('../docker-executor.js');
    const missing = path.join(os.tmpdir(), 'definitely-does-not-exist.cid');
    expect(__test__.readContainerIdFromCidfile(missing)).toBeNull();
  });

  it('空文件返回 null', async () => {
    const { __test__ } = await import('../docker-executor.js');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'cid-test-'));
    const p = path.join(tmp, 'empty.cid');
    writeFileSync(p, '', 'utf8');
    expect(__test__.readContainerIdFromCidfile(p)).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('长 ID 截前 12 位', async () => {
    const { __test__ } = await import('../docker-executor.js');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'cid-test-'));
    const p = path.join(tmp, 'x.cid');
    writeFileSync(p, '0123456789abcdef0123456789', 'utf8');
    expect(__test__.readContainerIdFromCidfile(p)).toBe('0123456789ab');
    rmSync(tmp, { recursive: true, force: true });
  });
});
