/**
 * Regression: SSH remoteCmd zsh word-splitting bug → env exit 127
 *
 * 根因（2026-06-28，r4 run）：
 *   - Brain 1.231.7 的 PATH fix 让 command -v timeout 能找到 /opt/homebrew/bin/timeout
 *   - 但 macOS 默认 shell 是 zsh，SSH 远端命令在 zsh 下执行
 *   - zsh 不对 ${TB:+$TB -k 10 10800s} 做 word splitting
 *   - env 把 "/opt/homebrew/bin/timeout -k 10 10800s" 当一个命令名 → No such file or directory → exit 127
 *
 * 验证：
 *   env CECELIA_HEADLESS=true ${TB:+$TB -k 10 10800s} echo HELLO
 *   → zsh: env: /opt/homebrew/bin/timeout -k 10 10800s: No such file or directory
 *   → bash: HELLO  ← 正确
 *
 * 修复（2026-06-28）：用 bash -c shq(innerCmd) 包裹，强制 bash 执行，bash 正确做 word splitting。
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

const baseTask = { id: 'task-zsh', task_type: 'harness_task' };

describe('host-executor SSH remoteCmd zsh word-splitting 修复（bash -c 包裹）', () => {
  it('SSH remoteCmd 必须以 bash -c 开头，不直接以 cd 开头（防 zsh word-split bug）', async () => {
    const captured = {};
    await executeOnHost({
      task: baseTask,
      prompt: 'test',
      worktreePath: '/Users/administrator/worktrees/wt-zsh',
      env: { BRAIN_URL: 'http://localhost:5221' },
      inContainer: true,
      hostSshTarget: 'administrator@host.docker.internal',
      hostSshKey: '/Users/administrator/.ssh/id_rsa',
      spawnFn: makeFakeSpawn(captured),
    });

    const remote = captured.args[captured.args.length - 1];
    // zsh 不做 ${TB:+...} word splitting → env 把整串当命令名 → exit 127
    // 修复后 remoteCmd 必须是 bash -c '<innerCmd>'，而非直接 cd ...
    expect(remote).toMatch(/^bash -c '/);
  });

  it('innerCmd 里仍保留 export PATH=/opt/homebrew/bin（PATH fix 不丢失）', async () => {
    const captured = {};
    await executeOnHost({
      task: baseTask,
      prompt: 'test',
      worktreePath: '/Users/administrator/worktrees/wt-zsh',
      inContainer: true,
      hostSshKey: '/k',
      spawnFn: makeFakeSpawn(captured),
    });

    const remote = captured.args[captured.args.length - 1];
    // bash -c '<innerCmd>' — innerCmd 包含 export PATH
    expect(remote).toContain('export PATH=/opt/homebrew/bin');
  });

  it('innerCmd 里保留 ${TB:+$TB -k 10 Xs} timeout wrapper', async () => {
    const captured = {};
    await executeOnHost({
      task: baseTask,
      prompt: 'test',
      worktreePath: '/Users/administrator/worktrees/wt-zsh',
      inContainer: true,
      hostSshKey: '/k',
      timeoutMs: 60_000,
      spawnFn: makeFakeSpawn(captured),
    });

    const remote = captured.args[captured.args.length - 1];
    // timeout wrapper 仍在 innerCmd 里
    expect(remote).toContain('${TB:+$TB -k 10');
  });
});
