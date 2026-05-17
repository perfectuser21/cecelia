/**
 * docker-executor exit=137 (OOM killed) alert 测试
 *
 * exit_code=137 = SIGKILL，常因 cgroup memory limit 触发或手动 kill。
 * 单次不阻塞 callback，但 P1 alert 通知主理人评估资源配置。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

import pool from '../db.js';
import { raise } from '../alerting.js';
import { writeDockerCallback } from '../docker-executor.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writeDockerCallback exit=137 OOM alert', () => {
  const baseTask = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    task_type: 'dev',
  };
  const baseResult = {
    container: 'cecelia-task-test',
    started_at: '2026-05-06T09:00:00Z',
    ended_at: '2026-05-06T09:01:00Z',
    duration_ms: 60000,
    stdout: '',
    stderr: 'OOM killed',
    timed_out: false,
  };

  it('exit=137 不是 timeout → 触发 P1 docker_oom_killed alert', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, { ...baseResult, exit_code: 137 });

    expect(raise).toHaveBeenCalledTimes(1);
    const [priority, key, message] = raise.mock.calls[0];
    expect(priority).toBe('P1');
    expect(key).toMatch(/docker_oom_killed/);
    expect(message).toMatch(/exit=137/);
    expect(message).toMatch(/SIGKILL/);
  });

  it('exit=0 不触发 alert', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, { ...baseResult, exit_code: 0 });
    expect(raise).not.toHaveBeenCalled();
  });

  it('exit=1 (普通失败) 不触发 OOM alert', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, { ...baseResult, exit_code: 1 });
    expect(raise).not.toHaveBeenCalled();
  });

  it('exit=137 但 timed_out=true → 当 timeout 处理，不触发 OOM alert', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, { ...baseResult, exit_code: 137, timed_out: true });
    expect(raise).not.toHaveBeenCalled();
  });

  it('exit=137 时 callback_queue insert 仍然成功（alert 不阻塞）', async () => {
    await writeDockerCallback(baseTask, 'run-1', null, { ...baseResult, exit_code: 137 });

    // pool.query 应该被调用（INSERT INTO callback_queue）
    expect(pool.query).toHaveBeenCalled();
    const insertCall = pool.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('callback_queue')
    );
    expect(insertCall).toBeDefined();
  });

  it('alert raise 抛错也不影响 callback 写入', async () => {
    raise.mockRejectedValueOnce(new Error('alerting service down'));

    // 不应该抛错（fire-and-forget catch）
    await expect(
      writeDockerCallback(baseTask, 'run-1', null, { ...baseResult, exit_code: 137 })
    ).resolves.toBeUndefined();
  });
});
