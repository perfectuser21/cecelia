import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock child_process.execFile（docker inspect）
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn() },
  readFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  reconnectOrSpawn,
  makeSessionRecord,
  _pollDockerStatus,
} from '../harness-session-bridge.js';

const mockExecFile = execFile;
const mockReadFile = readFile;

function makeExecFileCallable(impl) {
  mockExecFile.mockImplementation((cmd, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; }
    Promise.resolve().then(() => impl(cmd, args, cb));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认：docker inspect → container not found
  makeExecFileCallable((_cmd, _args, cb) => cb(new Error('No such object')));
  // 默认：readFile .cecelia-session-uuid → uuid
  mockReadFile.mockResolvedValue('test-session-uuid-1234\n');
});

describe('_pollDockerStatus', () => {
  it('running → "running"', async () => {
    makeExecFileCallable((_cmd, _args, cb) => cb(null, 'running:0\n', ''));
    const status = await _pollDockerStatus('cecelia-task-abc123');
    expect(status).toBe('running');
  });

  it('exited exit_code=0 → "exited_ok"', async () => {
    makeExecFileCallable((_cmd, _args, cb) => cb(null, 'exited:0\n', ''));
    expect(await _pollDockerStatus('cecelia-task-abc123')).toBe('exited_ok');
  });

  it('exited exit_code=137 → "exited_err"', async () => {
    makeExecFileCallable((_cmd, _args, cb) => cb(null, 'exited:137\n', ''));
    expect(await _pollDockerStatus('cecelia-task-abc123')).toBe('exited_err');
  });

  it('not found → "gone"', async () => {
    makeExecFileCallable((_cmd, _args, cb) => cb(new Error('No such object'), '', ''));
    expect(await _pollDockerStatus('cecelia-task-abc123')).toBe('gone');
  });
});

describe('reconnectOrSpawn', () => {
  const mockExecutor = vi.fn();
  const mockReadOutput = vi.fn();

  beforeEach(() => {
    mockExecutor.mockReset();
    mockReadOutput.mockReset();
  });

  it('state 无 session_info → fresh start，调 executor', async () => {
    mockExecutor.mockResolvedValue({ exit_code: 0, container: 'cecelia-task-new', stdout: 'out' });
    mockReadOutput.mockResolvedValue({ plannerOutput: 'prd' });

    const result = await reconnectOrSpawn({
      nodeKey: 'planner_session',
      state: {},
      executor: mockExecutor,
      taskArg: { task: { id: 't1' } },
      worktreePath: '/wt/test',
      readOutput: mockReadOutput,
    });

    expect(mockExecutor).toHaveBeenCalledOnce();
    expect(result.container).toBe('cecelia-task-new');
    expect(result.session_uuid).toBe('test-session-uuid-1234');
  });

  it('state 有 session_info，容器 exited_ok → readOutput，不调 executor', async () => {
    makeExecFileCallable((_cmd, _args, cb) => cb(null, 'exited:0\n', ''));
    mockReadOutput.mockResolvedValue({ plannerOutput: 'cached prd' });

    const result = await reconnectOrSpawn({
      nodeKey: 'planner_session',
      state: { planner_session: { container: 'cecelia-task-abc', session_uuid: 'old-uuid' } },
      executor: mockExecutor,
      taskArg: { task: { id: 't1' } },
      worktreePath: '/wt/test',
      readOutput: mockReadOutput,
    });

    expect(mockExecutor).not.toHaveBeenCalled();
    expect(mockReadOutput).toHaveBeenCalledOnce();
    expect(result.plannerOutput).toBe('cached prd');
  });

  it('state 有 session_info，容器 gone → fresh start', async () => {
    makeExecFileCallable((_cmd, _args, cb) => cb(new Error('No such object'), '', ''));
    mockExecutor.mockResolvedValue({ exit_code: 0, container: 'cecelia-task-new2', stdout: '' });
    mockReadOutput.mockResolvedValue({});

    await reconnectOrSpawn({
      nodeKey: 'planner_session',
      state: { planner_session: { container: 'cecelia-task-old', session_uuid: 'old-uuid' } },
      executor: mockExecutor,
      taskArg: { task: { id: 't1' } },
      worktreePath: '/wt/test',
      readOutput: mockReadOutput,
    });

    expect(mockExecutor).toHaveBeenCalledOnce();
  });
});

describe('makeSessionRecord', () => {
  it('从 spawnResult 提取 container + session_uuid', () => {
    const rec = makeSessionRecord({ container: 'c1', session_uuid: 'u1', exit_code: 0 });
    expect(rec).toEqual({ container: 'c1', session_uuid: 'u1' });
  });

  it('session_uuid 缺失时为 null', () => {
    const rec = makeSessionRecord({ container: 'c1', exit_code: 0 });
    expect(rec.session_uuid).toBeNull();
  });
});
