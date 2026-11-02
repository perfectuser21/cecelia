import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const fixtures = [];
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'module-contract-'));
  fixtures.push(root);
  const put = (path, text) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put('packages/brain/config/contracts/cecelia-module-boundaries.yaml', `contracts:
  - id: isolated_boundary
    description: Isolated boundary fixture
    consumer: src/consumer.js
    provider: src/provider.js
    signature_file: src/provider.js
    test_file: tests/boundary.test.js
    priority: P0
`);
  return { root, put };
}
const execute = (entry, args = [], cwd = repo) => spawnSync(process.execPath, [entry, ...args], {
  cwd, encoding: 'utf8', timeout: 10000,
});

describe('模块边界契约的真实CLI消费者', () => {
  it('扫描新配置位置并在dry-run报告未覆盖契约，不调用Brain', () => {
    const f = fixture();
    const result = execute(join(repo, 'packages/brain/scripts/run-contract-scan.mjs'), ['--dry-run', `--repo-root=${f.root}`]);
    expect(result.status, result.stderr).toBe(0);
    const summaryLine = result.stdout.trim().split('\n').at(-1);
    expect(summaryLine, result.stdout + result.stderr).toMatch(/^\{/);
    const summary = JSON.parse(summaryLine);
    expect(summary).toEqual({ event: 'contract_scan_complete', covered: 0, uncovered: 1, tasks_created: 1, errors: 0 });
    f.put('tests/boundary.test.js', '// covered fixture\n');
    const covered = execute(join(repo, 'packages/brain/scripts/run-contract-scan.mjs'), ['--dry-run', `--repo-root=${f.root}`]);
    expect(covered.status, covered.stderr).toBe(0);
    expect(JSON.parse(covered.stdout.trim().split('\n').at(-1))).toEqual({
      event: 'contract_scan_complete', covered: 1, uncovered: 0, tasks_created: 0, errors: 0,
    });
  });

  it('漂移检查从新配置读取P0边界：缺测试拒绝、有测试通过', () => {
    const f = fixture();
    const relative = 'scripts/devgate/check-contract-drift.mjs';
    f.put(relative, readFileSync(join(repo, relative)));
    symlinkSync(join(repo, 'node_modules'), join(f.root, 'node_modules'), 'dir');
    const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: f.root, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.name', 'Contract fixture');
    git('config', 'user.email', 'contract@example.invalid');
    f.put('src/consumer.js', 'export const before = true;\n');
    git('add', 'src');
    git('commit', '-qm', 'baseline');
    f.put('src/consumer.js', 'export const changed = true;\n');
    git('add', 'src');
    git('commit', '-qm', 'boundary changed');
    const missing = execute(join(f.root, relative), ['--base=HEAD~1'], f.root);
    expect(missing.status, missing.stdout + missing.stderr).toBe(1);
    expect(missing.stdout).toContain('isolated_boundary');
    f.put('tests/boundary.test.js', '// covered fixture\n');
    const covered = execute(join(f.root, relative), ['--base=HEAD~1'], f.root);
    expect(covered.status, covered.stdout + covered.stderr).toBe(0);
  });

  it('当前hook边界使用迁后真实合同测试，缺测试时漂移门禁拒绝', () => {
    const f = fixture();
    const config = 'packages/brain/config/contracts/cecelia-module-boundaries.yaml';
    f.put(config, readFileSync(join(repo, config)));
    const entry = 'scripts/devgate/check-contract-drift.mjs';
    f.put(entry, readFileSync(join(repo, entry)));
    symlinkSync(join(repo, 'node_modules'), join(f.root, 'node_modules'), 'dir');
    const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: f.root, stdio: 'pipe' });
    git('init', '-q'); git('config', 'user.name', 'Contract fixture'); git('config', 'user.email', 'contract@example.invalid');
    const guard = 'scripts/dev/hooks/branch-protect.sh';
    f.put(guard, '#!/bin/bash\nexit 0\n'); git('add', '.'); git('commit', '-qm', 'baseline');
    f.put(guard, '#!/bin/bash\nexit 1\n'); git('add', guard); git('commit', '-qm', 'guard changed');
    const missing = execute(join(f.root, entry), ['--base=HEAD~1'], f.root);
    expect(missing.status, missing.stdout + missing.stderr).toBe(1);
    expect(missing.stdout).toContain('hooks_dev_mode_format');
    const test = 'scripts/dev/hooks/__tests__/hook-contracts.test.ts';
    f.put(test, readFileSync(join(repo, test)));
    const covered = execute(join(f.root, entry), ['--base=HEAD~1'], f.root);
    expect(covered.status, covered.stdout + covered.stderr).toBe(0);
    expect(covered.stdout).toContain('hooks_dev_mode_format');
  });
});
