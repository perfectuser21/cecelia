import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = new URL('../../../', import.meta.url).pathname;
const yaml = createRequire(import.meta.url)('js-yaml');
test('归档真实开PR步骤只提交正常PR，不宣称harness标签或已移除的自动合并', () => {
  const directory = mkdtempSync(join(tmpdir(), 'archive-pr-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    git('init', '-q'); git('config', 'core.hooksPath', '/dev/null');
    git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    mkdirSync(join(directory, 'docs/learnings/archive'), { recursive: true });
    writeFileSync(join(directory, 'docs/learnings/old.md'), 'old'); git('add', '.'); git('commit', '-qm', 'chore: fixture');
    git('init', '--bare', '-q', join(directory, 'remote.git')); git('remote', 'add', 'origin', join(directory, 'remote.git'));
    git('rm', '-q', 'docs/learnings/old.md'); writeFileSync(join(directory, 'docs/learnings/archive/fixture.tar.gz'), 'archive-fixture');
    const bin = join(directory, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2))); process.stdout.write("https://example.invalid/pr/1\\n");\n'); chmodSync(join(bin, 'gh'), 0o755);
    const workflow = yaml.load(readFileSync(join(root, '.github/workflows/archive-learnings.yml'), 'utf8'));
    const step = workflow.jobs.archive.steps.find(step => step.run?.includes('gh pr create'));
    const capture = join(directory, 'capture.json');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], { cwd: directory, encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: 'fixture-only', TOTAL: '1', BUCKETS: '1', CAPTURE: capture, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(readFileSync(capture));
    assert.ok(!args.includes('--label'), '正常归档不再打旧harness特殊标签');
    assert.doesNotMatch(args[args.indexOf('--body') + 1], /auto-merge|自动合并|跳过.*硬门禁/);
    assert.match(args[args.indexOf('--body') + 1], /源码.*检查/);
    assert.match(git('ls-remote', '--heads', 'origin'), /archive-learnings/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
