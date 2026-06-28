/**
 * Regression: host-executor remoteCmd 缺 export PATH → SSH 非交互 PATH 无 /opt/homebrew/bin
 * → claude-launch.sh `command -v claude` 返回空 → exit 127 → fix loop 无限重试。
 *
 * 根因（2026-06-28，r3 run 36446078）：
 *   - SSH BatchMode=yes 不加载用户 shell profile，PATH 仅 /usr/bin:/bin:/usr/sbin:/sbin
 *   - claude binary 在 /opt/homebrew/bin/claude，不在默认 PATH
 *   - 每次 host-executor 均 exit=127，ci_status='fail' → fix_dispatch → 无限 loop → 撞 LangGraph recursion 200
 *
 * 修复：remoteCmd 头部插入 `export PATH=/opt/homebrew/bin:/usr/local/bin:...:$PATH`
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { executeOnHost } from '../host-executor.js';

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
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
}

const baseTask = { id: 'task-abc', task_type: 'harness_task' };

describe('host-executor remoteCmd PATH export（防 exit 127）', () => {
  it('SSH remoteCmd 必须包含 export PATH=/opt/homebrew/bin，确保 claude binary 可找到', async () => {
    const captured = {};
    await executeOnHost({
      task: baseTask,
      prompt: 'test',
      worktreePath: '/Users/administrator/worktrees/wt-x',
      env: { BRAIN_URL: 'http://localhost:5221' },
      inContainer: true,
      hostSshTarget: 'administrator@host.docker.internal',
      hostSshKey: '/Users/administrator/.ssh/id_rsa',
      spawnFn: makeFakeSpawn(captured),
    });

    const remote = captured.args[captured.args.length - 1];
    // 非交互 SSH PATH 无 homebrew → claude-launch.sh exit 127 → fix loop 死循环
    // 修复后必须在 remoteCmd 头部 export PATH 包含 /opt/homebrew/bin
    expect(remote).toContain('export PATH=/opt/homebrew/bin');
  });

  it('PATH export 必须在 TB=$(command -v timeout) 之前，确保 timeout/gtimeout 也能被找到', async () => {
    const captured = {};
    await executeOnHost({
      task: baseTask,
      prompt: 'test',
      worktreePath: '/Users/administrator/worktrees/wt-x',
      inContainer: true,
      hostSshKey: '/k',
      timeoutMs: 60_000,
      spawnFn: makeFakeSpawn(captured),
    });

    const remote = captured.args[captured.args.length - 1];
    const pathIdx = remote.indexOf('export PATH=/opt/homebrew/bin');
    const tbIdx = remote.indexOf('command -v timeout');
    expect(pathIdx).toBeGreaterThan(-1);
    expect(tbIdx).toBeGreaterThan(-1);
    // export PATH 必须在 TB=... 之前
    expect(pathIdx).toBeLessThan(tbIdx);
  });
});
