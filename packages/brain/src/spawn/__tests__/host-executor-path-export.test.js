/**
 * host-executor remoteCmd PATH export（防 exit 127）
 *
 * 原用例（remoteCmd 含 export PATH=/opt/homebrew/bin 且位于 timeout 探测之前）已随 Claude 通道退役删除（任务 76a160b3）：
 * executeOnHost 唯一用途是拼 claude 命令（容器内 SSH 逃逸 / 裸机直跑），现一律拒绝。
 * 保留断言：不再拼 remoteCmd，直接拒绝。
 */
import { describe, it, expect, vi } from 'vitest';
import { executeOnHost } from '../host-executor.js';

describe('host-executor remoteCmd PATH export（防 exit 127）', () => {
  it('不再拼 SSH remoteCmd：一律抛 claude_channel_retired，spawnFn 不被调用', async () => {
    const spawnFn = vi.fn();
    for (const inContainer of [true, false]) {
      await expect(executeOnHost({
        task: { id: 'task-abc', task_type: 'harness_generator' },
        prompt: 'do the thing',
        worktreePath: '/Users/administrator/worktrees/wt-x',
        env: { BRAIN_URL: 'http://localhost:5221' },
        inContainer,
        hostSshTarget: 'administrator@host.docker.internal',
        hostSshKey: '/Users/administrator/.ssh/id_rsa',
        spawnFn,
      })).rejects.toMatchObject({ code: 'claude_channel_retired' });
    }
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
