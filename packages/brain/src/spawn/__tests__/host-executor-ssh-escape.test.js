/**
 * Regression: host-executor 在容器内必须 ssh 逃逸到主机跑 claude。
 *
 * Bug 根因（2026-06-26）：brain 跑在 docker 容器里，executeOnHost 直接
 * spawn('claude') → 容器内无 claude、PATH 无 /opt/homebrew/bin → spawn claude ENOENT，
 * 所有 mac_web harness 任务卡死。修复：检测到 /.dockerenv（容器）时改为
 * ssh -i <key> administrator@host.docker.internal "cd <wt> && env ... bash claude-launch.sh ..."，
 * 让 claude 真正在主机执行（真实浏览器 + homebrew PATH）。
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { executeOnHost } from '../host-executor.js';

// 假 child：捕获 spawn 调用，立即 exit 0
function makeFakeSpawn(captured) {
  return (bin, args, optsArg) => {
    captured.bin = bin;
    captured.args = args;
    captured.spawnOpts = optsArg;
    const child = new EventEmitter();
    child.stdin = { on() {}, write() {}, end() {} };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    // 下一个 tick 触发 exit，让 Promise resolve
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
}

const baseTask = { id: 'task-abc', task_type: 'harness_generator' };

describe('host-executor ssh 逃逸（容器内）', () => {
  it('inContainer=true 时 spawn 的是 ssh，目标主机，远端命令含 claude + worktree + 注入 env', async () => {
    const captured = {};
    await executeOnHost({
      task: baseTask,
      prompt: 'do the thing',
      worktreePath: '/Users/administrator/worktrees/wt-x',
      env: { BRAIN_URL: 'http://localhost:5221' },
      inContainer: true,
      hostSshTarget: 'administrator@host.docker.internal',
      hostSshKey: '/Users/administrator/.ssh/id_rsa',
      spawnFn: makeFakeSpawn(captured),
    });

    expect(captured.bin).toBe('ssh');
    // 显式私钥 + 目标主机
    expect(captured.args).toContain('-i');
    expect(captured.args).toContain('/Users/administrator/.ssh/id_rsa');
    expect(captured.args).toContain('administrator@host.docker.internal');
    // 远端命令（最后一个 arg）必须真正在主机跑 claude，cd 到 worktree，带注入 env
    const remote = captured.args[captured.args.length - 1];
    expect(remote).toMatch(/claude/);
    expect(remote).toContain('/Users/administrator/worktrees/wt-x');
    expect(remote).toContain('CECELIA_TASK_ID');
    expect(remote).toContain('BRAIN_URL');
    // 关键：远端不能是容器内那个错误的 bare claude（必须经过主机 PATH）
    expect(captured.bin).not.toBe('claude');
  });

  it('inContainer=false（裸机）时回退到本机直接 spawn，不走 ssh', async () => {
    const captured = {};
    await executeOnHost({
      task: baseTask,
      prompt: 'do the thing',
      worktreePath: '/tmp/wt-y',
      inContainer: false,
      spawnFn: makeFakeSpawn(captured),
    });
    expect(captured.bin).not.toBe('ssh');
    expect(['bash', 'claude']).toContain(captured.bin);
  });
});
