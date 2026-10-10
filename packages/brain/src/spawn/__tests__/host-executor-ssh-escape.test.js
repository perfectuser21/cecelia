/**
 * host-executor ssh 逃逸（容器内）
 *
 * 原用例（ssh 目标/私钥/远端 claude-launch.sh 命令、宿主侧 timeout 包裹、裸机直跑回退）已随 Claude 通道退役删除（任务 76a160b3）：
 * executeOnHost 唯一用途是拼 claude 命令（容器内 SSH 逃逸 / 裸机直跑），现一律拒绝。
 * 保留断言：容器内/裸机都不发起 ssh、不 spawn 任何进程。
 */
import { describe, it, expect, vi } from 'vitest';
import { executeOnHost } from '../host-executor.js';

describe('host-executor ssh 逃逸（容器内）', () => {
  it('inContainer=true/false 均抛 claude_channel_retired，不 spawn ssh 也不本机 spawn', async () => {
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
