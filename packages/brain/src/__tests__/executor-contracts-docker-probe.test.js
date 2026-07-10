/**
 * executor-contracts-docker-probe.test.js
 *
 * 回归测试：brain-local docker probe (#bluegreen-suicide-guard-v2 bugfix)
 *
 * 根因：Brain 重启后 docker-executor 派发的 cecelia-task-* 容器不被 reAttachActiveExecutors
 * 识别，activeProcesses 无条目 → brain-local probe 返回 unknown(fail-open)，
 * 但 syncOrphanTasksOnStartup 仍按 OS 进程探活 → 判孤 → dead-reset 双开。
 *
 * 修法：activeProcesses 增 docker=true 标记；brain-local probe 对 docker=true 走
 * docker ps 探活（返回 alive/dead），而非 unknown。
 *
 * 验收（PRD 要求）：mock docker ps 含 cecelia-task-<id> 时 assessTaskLiveness 返回 alive。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockExecSync;
vi.mock('child_process', () => ({
  execSync: (...args) => mockExecSync(...args),
  spawn: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
}));

import {
  EXECUTOR_CONTRACTS,
  assessTaskLiveness,
} from '../executor-contracts.js';

function makeTask(overrides = {}) {
  return {
    id: 'df5959a0-1234-5678-abcd-ef0123456789',
    status: 'in_progress',
    executor_kind: 'brain-local',
    updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30min ago（宽限期内）
    last_attempt_at: null,
    claimed_by: null,
    ...overrides,
  };
}

describe('brain-local probe — docker=true (cecelia-task-* 容器)', () => {
  beforeEach(() => {
    mockExecSync = vi.fn(() => '');
  });

  it('docker ps 返回 cecelia-task-* 容器 → probe=alive → assessTaskLiveness verdict=alive', async () => {
    const TASK_ID = 'df5959a0-1234-5678-abcd-ef0123456789';
    // short12 = 'df5959a01234'
    const containerName = 'cecelia-task-df5959a01234-ab12cd34';

    mockExecSync.mockImplementation((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('cecelia-task-df5959a01234')) {
        return containerName;
      }
      return '';
    });

    const activeProcesses = new Map();
    activeProcesses.set(TASK_ID, {
      pid: null,
      docker: true,
      source: 'reattach_docker_task',
    });

    const task = makeTask({ id: TASK_ID });
    const result = await assessTaskLiveness(task, { activeProcesses });

    expect(result.verdict).toBe('alive');
  });

  it('docker ps 无对应容器 → probe=dead → updated_at 宽限期内 verdict=alive（stale_window 保护）', async () => {
    const TASK_ID = 'df5959a0-1234-5678-abcd-ef0123456789';

    mockExecSync.mockReturnValue(''); // docker ps 无输出

    const activeProcesses = new Map();
    activeProcesses.set(TASK_ID, {
      pid: null,
      docker: true,
      source: 'reattach_docker_task',
    });

    // updated_at 30min ago → 宽限期 60min 内 → verdict 被宽限为 alive
    const task = makeTask({
      id: TASK_ID,
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    const result = await assessTaskLiveness(task, { activeProcesses });

    // dead + 30min < 60min staleMinutes → within_stale_window → alive
    expect(result.verdict).toBe('alive');
    expect(result.reason).toBe('within_stale_window');
  });

  it('docker ps 无容器 + updated_at > 60min → verdict=dead, onStale=fail', async () => {
    const TASK_ID = 'df5959a0-1234-5678-abcd-ef0123456789';

    mockExecSync.mockReturnValue('');

    const activeProcesses = new Map();
    activeProcesses.set(TASK_ID, {
      pid: null,
      docker: true,
      source: 'reattach_docker_task',
    });

    const task = makeTask({
      id: TASK_ID,
      updated_at: new Date(Date.now() - 70 * 60 * 1000).toISOString(), // 70min ago
    });
    const result = await assessTaskLiveness(task, { activeProcesses });

    expect(result.verdict).toBe('dead');
    expect(result.onStale).toBe('fail');
  });

  it('docker ps 抛错 → probe=unknown → fail-open，verdict=unknown（不杀）', async () => {
    const TASK_ID = 'df5959a0-1234-5678-abcd-ef0123456789';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockExecSync.mockImplementation(() => {
      throw new Error('docker: command not found');
    });

    const activeProcesses = new Map();
    activeProcesses.set(TASK_ID, {
      pid: null,
      docker: true,
      source: 'reattach_docker_task',
    });

    const task = makeTask({ id: TASK_ID });
    const result = await assessTaskLiveness(task, { activeProcesses });

    expect(result.verdict).toBe('unknown');
    warnSpy.mockRestore();
  });

  it('bridge=true 条目（非 docker）→ unknown fail-open（行为不变）', async () => {
    const TASK_ID = 'df5959a0-1234-5678-abcd-ef0123456789';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const activeProcesses = new Map();
    activeProcesses.set(TASK_ID, {
      pid: null,
      bridge: true,
    });

    const task = makeTask({ id: TASK_ID });
    const result = await assessTaskLiveness(task, { activeProcesses });

    expect(result.verdict).toBe('unknown');
    warnSpy.mockRestore();
  });
});
