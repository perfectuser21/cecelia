// brain-unit 分片的测试范围判定（ci.yml「Determine test scope」）回归测试。
// 2026-10-10 #6168 只改 workflow，scope 判成 skip → 读 ci.yml 的 fs 守卫测试（walking-ci-owner）漏跑，
// 合并后 main 的 brain-unit 红（任务 a3e63245）。没有 brain 变更时也必须跑 fs 守卫组，不能整片跳过。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

const ROOT = path.resolve(__dirname, '../../../..');
const workflow = YAML.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
const scopeScript = workflow.jobs['brain-unit'].steps.find(s => s.name === 'Determine test scope').run
  .replaceAll('${{ github.event_name }}', 'pull_request')
  .replaceAll('${{ github.base_ref }}', 'main');

let repo;
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();

function scopeFor(changedFile) {
  git('checkout', '-q', '-B', 'pr', 'main');
  fs.mkdirSync(path.dirname(path.join(repo, changedFile)), { recursive: true });
  fs.writeFileSync(path.join(repo, changedFile), `${Date.now()}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'change');
  const out = path.join(repo, '.out');
  fs.writeFileSync(out, '');
  execFileSync('bash', ['-c', scopeScript], { cwd: repo, env: { ...process.env, GITHUB_OUTPUT: out }, stdio: 'pipe' });
  return /mode=(\S+)/.exec(fs.readFileSync(out, 'utf8'))?.[1];
}

describe('brain-unit 测试范围判定', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-unit-scope-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'README'), 'x\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    git('update-ref', 'refs/remotes/origin/main', 'main');
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('只改 workflow 的 PR 不能整片跳过（必须跑 fs 守卫组）', () => {
    expect(scopeFor('.github/workflows/ci.yml')).toBe('guards');
  });

  it('改 brain 源码走 changed 模式', () => {
    expect(scopeFor('packages/brain/src/x.js')).toBe('changed');
  });
});
