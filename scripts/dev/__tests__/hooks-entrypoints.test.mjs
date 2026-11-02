import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'dev-hooks-'));
  const env = { ...process.env, HOME: join(dir, 'home'), GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), VITEST: '', JEST_WORKER_ID: '' };
  for (const key of Object.keys(env)) if (key.startsWith('CECELIA_ROUTING_') || key.startsWith('GIT_') && key !== 'GIT_CONFIG_GLOBAL') delete env[key];
  mkdirSync(env.HOME);
  const repo = join(dir, 'repo');
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env, stdio: 'pipe' });
  mkdirSync(repo); git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Hook fixture'); git('config', 'user.email', 'hooks@example.invalid');
  writeFileSync(join(repo, 'file.txt'), 'base\n'); git('add', '.'); git('commit', '-qm', 'base');
  const hook = (name, input, cwd = repo) => spawnSync('bash', [resolve(root, 'scripts/dev/hooks', name)], {
    cwd, env, input: JSON.stringify(input), encoding: 'utf8', timeout: 10000,
  });
  try { run({ dir, env, repo, git, hook }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('新branch入口真实stdin：main代码写入拒绝，linked cp会话带锚放行', () => fixture(({ dir, repo, git, hook }) => {
  assert.equal(hook('branch-protect.sh', { tool_name: 'Write', tool_input: { file_path: join(repo, 'code.js') } }).status, 2);
  const wt = join(dir, 'wt'), branch = 'cp-11021234-hook-fixture';
  git('worktree', 'add', '-q', '-b', branch, wt);
  writeFileSync(join(wt, '.dev-mode.' + branch), 'gp_anchor: none(infra)\n');
  assert.equal(hook('branch-protect.sh', { tool_name: 'Write', tool_input: { file_path: join(wt, 'code.js') } }, wt).status, 0);
}));

test('新bash入口拒绝凭据内容复制和main源码重定向，安全读取放行', () => fixture(({ hook }) => {
  for (const command of ['cp ~/.credentials/private.env ./leak.env', 'echo changed > scripts/code.js']) {
    assert.equal(hook('bash-guard.sh', { tool_name: 'Bash', tool_input: { command } }).status, 2);
  }
  assert.equal(hook('bash-guard.sh', { tool_name: 'Bash', tool_input: { command: 'git status --short' } }).status, 0);
}));

test('新main-repo入口拒绝主树Edit但允许linked worktree', () => fixture(({ dir, repo, git, hook }) => {
  assert.equal(hook('main-repo-write-guard.sh', { tool_name: 'Edit', cwd: repo }).status, 2);
  const wt = join(dir, 'wt'); git('worktree', 'add', '-q', '-b', 'cp-fixture', wt);
  assert.equal(hook('main-repo-write-guard.sh', { tool_name: 'Edit', cwd: wt }, wt).status, 0);
}));

test('新dev-mode入口保留live light后台纪律及前台放行', () => fixture(({ repo, hook }) => {
  mkdirSync(join(repo, '.cecelia/lights'), { recursive: true });
  writeFileSync(join(repo, '.cecelia/lights/private.live'), '{}');
  assert.equal(hook('dev-mode-tool-guard.sh', { tool_name: 'ScheduleWakeup', cwd: repo }).status, 2);
  assert.equal(hook('dev-mode-tool-guard.sh', { tool_name: 'Bash', cwd: repo, tool_input: { run_in_background: true } }).status, 2);
  assert.equal(hook('dev-mode-tool-guard.sh', { tool_name: 'Bash', cwd: repo, tool_input: { run_in_background: false } }).status, 0);
}));

test('私有HOME安装pre-commit后真实git commit在main拒绝，cp会话提交通过', () => fixture(({ dir, repo, env, git }) => {
  const installed = spawnSync('bash', [resolve(root, 'scripts/install-global-hooks.sh')], { cwd: repo, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  assert.equal(readlinkSync(join(env.HOME, '.git-hooks/pre-commit')), resolve(root, 'scripts/dev/hooks/pre-commit'));
  writeFileSync(join(repo, 'file.txt'), 'changed\n'); git('add', '.');
  const rejected = spawnSync('git', ['commit', '-qm', 'fix: fixture'], { cwd: repo, env, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /PRE-COMMIT/);
  git('checkout', '-q', '-b', 'cp-11021234-precommit');
  writeFileSync(join(repo, '.dev-mode.cp-11021234-precommit'), 'gp_anchor: none(infra)\n');
  const accepted = spawnSync('git', ['commit', '-qm', 'fix: fixture'], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
}));

test('退休Engine目录变更不再要求独立CONFIG标签，正常PR标题放行', () => fixture(({ repo, git, hook }) => {
  git('checkout', '-q', '-b', 'cp-11021234-retire-engine');
  mkdirSync(join(repo, 'packages/engine'), { recursive: true });
  writeFileSync(join(repo, 'packages/engine/legacy.txt'), 'retirement fixture\n');
  git('add', '.'); git('commit', '-qm', 'refactor: retire engine');
  const result = hook('bash-guard.sh', { tool_name: 'Bash', tool_input: {
    command: 'gh pr create --title "refactor: retire legacy package" --body "fixture"',
  } });
  assert.equal(result.status, 0, result.stderr);
}));
