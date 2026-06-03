/**
 * docker-executor exit=1 auth 失败分类
 *
 * exit_code=1 且 stdout/stderr 含 auth 特征字符串 → failure_class = 'docker_auth_failure'
 * exit_code=1 但无 auth 特征 → failure_class = 'docker_nonzero_exit'（既有行为不变）
 *
 * 已知 auth 失败模式（来自账号 account3/account2 403 / not-logged-in）：
 *   - "Not logged in" / "not logged in"
 *   - "Error: Not logged in to Claude.ai"
 *   - "403 Forbidden"
 *   - "403" + "account"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

import pool from '../db.js';
import { writeDockerCallback } from '../docker-executor.js';

const baseTask = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  task_type: 'harness_initiative',
};

const baseResult = {
  container: 'cecelia-task-test',
  started_at: '2026-06-03T09:00:00Z',
  ended_at: '2026-06-03T09:01:00Z',
  duration_ms: 5000,
  timed_out: false,
};

/** 从 pool.query mock calls 里提取 callback_queue INSERT 的 failure_class 参数 */
function extractFailureClass() {
  const insertCall = pool.query.mock.calls.find(c =>
    typeof c[0] === 'string' && c[0].includes('callback_queue')
  );
  if (!insertCall) return undefined;
  // _insertArgs[9] = failureClass（第 10 个参数）
  return insertCall[1][9];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writeDockerCallback exit=1 auth 失败分类', () => {
  it('"Not logged in" in stdout → docker_auth_failure', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, {
      ...baseResult,
      exit_code: 1,
      stdout: 'Error: Not logged in to Claude.ai\nPlease run claude login',
      stderr: '',
    });
    expect(extractFailureClass()).toBe('docker_auth_failure');
  });

  it('"not logged in"（小写）in stderr → docker_auth_failure', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, {
      ...baseResult,
      exit_code: 1,
      stdout: '',
      stderr: 'claude: error: not logged in',
    });
    expect(extractFailureClass()).toBe('docker_auth_failure');
  });

  it('"403 Forbidden" in stdout → docker_auth_failure', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, {
      ...baseResult,
      exit_code: 1,
      stdout: 'HTTP 403 Forbidden: account3 subscription not available',
      stderr: '',
    });
    expect(extractFailureClass()).toBe('docker_auth_failure');
  });

  it('"403" in stderr → docker_auth_failure', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, {
      ...baseResult,
      exit_code: 1,
      stdout: '',
      stderr: 'Request failed: 403',
    });
    expect(extractFailureClass()).toBe('docker_auth_failure');
  });

  it('exit_code=1 但无 auth 特征 → docker_nonzero_exit（既有行为不变）', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, {
      ...baseResult,
      exit_code: 1,
      stdout: 'some unexpected error occurred',
      stderr: 'bash: command not found',
    });
    expect(extractFailureClass()).toBe('docker_nonzero_exit');
  });

  it('exit_code=0 → failure_class = null（成功无 class）', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, {
      ...baseResult,
      exit_code: 0,
      stdout: '',
      stderr: '',
    });
    expect(extractFailureClass()).toBeNull();
  });

  it('exit_code=137 → docker_oom_killed（auth 检测不干扰 OOM 分类）', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, {
      ...baseResult,
      exit_code: 137,
      stdout: 'Not logged in', // 即使有 auth 字符串，137 仍优先识别为 OOM
      stderr: '',
    });
    expect(extractFailureClass()).toBe('docker_oom_killed');
  });
});
