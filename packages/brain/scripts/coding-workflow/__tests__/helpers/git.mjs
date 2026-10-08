// 测试里起 git 的统一入口：每次调用时剥离继承的 GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE，
// 避免测试在 git 钩子（如 pre-push）里运行时把 config/add/commit 写进真实仓库。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { childEnv } from '../../lib/protocol.mjs';

/** 在 cwd 仓库执行 git，返回 stdout。 */
export function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv(),
  });
}

/** 不带 -C 的 git（init/clone 等），输出丢弃。 */
export function gitPlain(...args) {
  execFileSync('git', args, { stdio: 'ignore', env: childEnv() });
}

/**
 * 在已存在的空目录 worktree 建可提交的测试仓：切到 branch、配本地 user、
 * core.hooksPath 指向空目录 hooksDir（规避本机全局钩子），并做一个空的初始提交。
 */
export function initCommittableRepo(worktree, hooksDir, branch = 'cp-1008000000-test') {
  fs.mkdirSync(hooksDir, { recursive: true });
  gitPlain('init', '-q', worktree);
  git(worktree, 'checkout', '-q', '-b', branch);
  git(worktree, 'config', 'user.name', 'test');
  git(worktree, 'config', 'user.email', 'test@example.com');
  git(worktree, 'config', 'core.hooksPath', hooksDir);
  git(worktree, 'commit', '-q', '--allow-empty', '-m', 'chore: init');
}
