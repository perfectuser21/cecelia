// verify 经执行器取消（callActivityProcess + AbortSignal）时，暂移出去的 03-build.md 必须放回：
// 取消可能落在 claude 运行期间，也可能落在 claude 退出后的检查阶段（此时 runClaude 的 SIGTERM 处理已摘掉）。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { callActivityProcess } from '../../../src/orchestrator/activity-process.js';
import { git, gitPlain, initCommittableRepo } from './helpers/git.mjs';
import { withProcessEnv, waitForFile } from './helpers/procs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const ACTIVITY = {
  key: 'verify',
  runtime: { entry: 'activities/verify.mjs' },
  budget: { max_duration_s: 1200, heartbeat_s: 30 },
};

describe('verify 被执行器取消时放回 03-build.md', () => {
  let root;
  let worktree;
  let buildFile;

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cancel-'));
    worktree = path.join(root, 'wt');
    fs.mkdirSync(worktree);
    initCommittableRepo(worktree, path.join(root, 'no-hooks'));
    fs.mkdirSync(path.join(worktree, 'sprints/s1'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), '# intent\n');
    buildFile = path.join(worktree, 'sprints/s1/03-build.md');
    fs.writeFileSync(buildFile, '# build 自述\n');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const input = { run_tag: 'rt-1', task_id: TASK_ID, worktree, sprint_dir: 'sprints/s1', intent_ids: ['I-1'] };
  const cancelWhen = async (readyFile, env) => withProcessEnv(env, async () => {
    const ac = new AbortController();
    const pending = callActivityProcess(ACTIVITY, { ...input, worktree }, { cwd: path.join(HERE, '..'), signal: ac.signal });
    await waitForFile(readyFile);
    ac.abort();
    return pending;
  });
  const expectRestored = () => {
    expect(fs.readFileSync(buildFile, 'utf8')).toBe('# build 自述\n');
    const gitDir = git(worktree, 'rev-parse', '--absolute-git-dir').trim();
    expect(fs.existsSync(path.join(gitDir, 'coding-wf/03-build.md'))).toBe(false);
  };

  it('取消落在 claude 运行期间 -> 03 放回', async () => {
    const pidFile = path.join(root, 'claude.pid');
    const r = await cancelWhen(pidFile, {
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_MODE: 'sleep',
      FAKE_CLAUDE_PID_FILE: pidFile,
    });
    expect(r.reason_code).toBe('run_cancelled');
    expectRestored();
  }, 30000);

  it('取消落在 claude 退出后的检查阶段（ls-remote 卡住）-> 03 放回', async () => {
    // 包一层 git：第二次 ls-remote（运行后的远端比对）写标记并卡住，模拟网络挂起
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const binDir = path.join(root, 'bin');
    const counter = path.join(root, 'ls-remote.count');
    const mark = path.join(root, 'ls-remote.hang');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'git'), [
      '#!/bin/sh',
      'case "$*" in *ls-remote*)',
      `  n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${counter}"`,
      `  if [ "$n" -ge 2 ]; then touch "${mark}"; sleep 30; fi;;`,
      'esac',
      `exec "${realGit}" "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    const origin = path.join(root, 'origin.git');
    gitPlain('init', '--bare', '-q', origin);
    git(worktree, 'remote', 'add', 'origin', origin);

    const r = await cancelWhen(mark, {
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_MODE: 'verify-pass',
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });
    expect(r.reason_code).toBe('run_cancelled');
    expectRestored();
  }, 30000);
});
