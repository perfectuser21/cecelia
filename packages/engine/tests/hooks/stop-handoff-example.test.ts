import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('真实 stop hook 拦截未交接任务时，示例列出当前四类 next_steps', () => {
  const root = mkdtempSync(join(tmpdir(), 'stop-handoff-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(join(root, '.git'));
  const taskId = 'edff1622-afc3-43af-b950-baf30ca68348';
  writeFileSync(join(root, '.dev-mode'), `task_id: ${taskId}\n`);
  // 隔离全部外部副作用；真实 hook 仍负责读取任务、判定拦截及输出示例。
  writeFileSync(join(bin, 'git'), '#!/bin/sh\ncase "$*" in\n *--show-toplevel*) pwd;;\n *--git-common-dir*) echo .git;;\nesac\n', { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), `#!/bin/sh\ncase "$*" in\n */api/brain/tasks/*) echo '{"status":"in_progress","result":{}}';;\nesac\n`, { mode: 0o755 });
  try {
    const result = spawnSync('bash', [resolve(__dirname, '../../hooks/stop.sh')], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELAY_HANDOFF_GATE: 'on',
        CLAUDE_HOOK_STDIN_JSON_OVERRIDE: JSON.stringify({ session_id: 'example-test', transcript_path: '', cwd: root }) },
      encoding: 'utf8', timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toContain('没有 handoff');
    const line = result.stdout.split('\n').find(value => value.includes("-d '{"));
    expect(line).toBeDefined();
    const payload = JSON.parse(line!.trim().slice(4, -1));
    expect(payload.result.handoff.task_id).toBe(taskId);
    expect(payload.result.handoff.next_steps[0].kind.split('|')).toEqual([
      'resume_headed', 'dispatch_headless', 'decision', 'note',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
