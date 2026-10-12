import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareWorktree } from '../runner/lib/worktree.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-base-'));
  roots.push(root);
  const origin = path.join(root, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-b', 'main');
  git(origin, 'config', 'user.name', 'fixture');
  git(origin, 'config', 'user.email', 'fixture@example.invalid');
  git(origin, 'config', 'core.hooksPath', '/dev/null');
  fs.writeFileSync(path.join(origin, 'value.txt'), 'registered base\n');
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'fixture base');
  const base = git(origin, 'rev-parse', 'HEAD');
  const blob = git(origin, 'rev-parse', 'HEAD:value.txt');
  const repo = path.join(root, 'clone');
  git(root, 'clone', origin, repo);
  // 任务登记后，远端 main 又前进；prepareWorktree 的 fetch 必须看到新 tip。
  fs.writeFileSync(path.join(origin, 'value.txt'), 'new main\n');
  git(origin, 'commit', '-am', 'fixture advance');
  const tip = git(origin, 'rev-parse', 'HEAD');
  const cfg = { repo, worktreeBase: path.join(root, 'worktrees'), skipNpmCi: true };
  const names = { short: 'abcd1234', stamp: 'fixture', branch: 'cp-10121425-fixture' };
  const run = (payload) => prepareWorktree(cfg, { id: 'fixture-task', payload }, names, {}, null);
  return { root, repo, base, blob, tip, run, cfg, names };
}

test('真实 Git：main 前进后仍在任务登记的 base_sha 建独立分支', async (t) => {
  const f = fixture(t);
  const worktree = await f.run({ base_sha: f.base });
  assert.equal(git(f.repo, 'rev-parse', 'origin/main'), f.tip);
  assert.equal(git(worktree, 'rev-parse', 'HEAD'), f.base);
  assert.equal(fs.readFileSync(path.join(worktree, 'value.txt'), 'utf8'), 'registered base\n');
  assert.equal(git(worktree, 'branch', '--show-current'), f.names.branch);
});

test('真实 Git：旧任务不带 base_sha 时仍使用 fetch 后的 origin/main', async (t) => {
  const f = fixture(t);
  const worktree = await f.run({});
  assert.equal(git(worktree, 'rev-parse', 'HEAD'), f.tip);
});

for (const value of ['main', '--detach', '', null, 'A'.repeat(40)]) {
  test(`非法显式 base_sha ${JSON.stringify(value)} 不创建 worktree`, async (t) => {
    const f = fixture(t);
    await assert.rejects(f.run({ base_sha: value }), /task_base_sha_invalid/);
    assert.equal(fs.existsSync(path.join(f.cfg.worktreeBase, 'cw-abcd1234')), false);
  });
}

test('真实 Git：不存在的 40 位 SHA 明确失败，不回退 main', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.run({ base_sha: 'f'.repeat(40) }), /task_base_commit_missing/);
  assert.equal(fs.existsSync(path.join(f.cfg.worktreeBase, 'cw-abcd1234')), false);
});

test('真实 Git：存在的 blob SHA 不是 commit，明确失败', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.run({ base_sha: f.blob }), /task_base_commit_missing/);
  assert.equal(fs.existsSync(path.join(f.cfg.worktreeBase, 'cw-abcd1234')), false);
});
