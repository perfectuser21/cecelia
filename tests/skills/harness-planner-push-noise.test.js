// SPDX-License-Identifier: MIT
// Test for harness-planner SKILL.md Step 3 git push fallback.
// 目的：保证 planner 容器无 push creds 时 SKILL 不被 set -e 整脚本打挂。

import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SKILL_PATH = path.join(REPO_ROOT, 'packages/workflows/skills/harness-planner/SKILL.md');

function extractPushLine() {
  const src = readFileSync(SKILL_PATH, 'utf8');
  const m = src.match(/^git push origin HEAD.*$/m);
  if (!m) throw new Error('git push origin HEAD line not found in SKILL.md');
  return m[0];
}

function runWithMockGit({ pushExitCode }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'h9-push-'));

  const mockGit = path.join(dir, 'git');
  writeFileSync(
    mockGit,
    `#!/usr/bin/env bash
if [[ "$1" == "push" ]]; then
  echo "fatal: could not read Username for 'https://github.com'" >&2
  exit ${pushExitCode}
fi
exit 0
`,
    'utf8',
  );
  chmodSync(mockGit, 0o755);

  const pushLine = extractPushLine();
  const wrapper = `set -e\n${pushLine}\necho "AFTER_PUSH"\n`;

  const result = spawnSync('bash', ['-c', wrapper], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
  });

  return { dir, result };
}

describe('harness-planner SKILL Step 3 push fallback', () => {
  const dirsToCleanup = [];
  afterEach(() => {
    while (dirsToCleanup.length) {
      try { rmSync(dirsToCleanup.pop(), { recursive: true, force: true }); } catch {}
    }
  });

  test('push fail (no creds) → fallback echo 打，整体 exit 0，set -e 不 abort', () => {
    const { dir, result } = runWithMockGit({ pushExitCode: 1 });
    dirsToCleanup.push(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('push skipped');
    expect(result.stdout).toContain('AFTER_PUSH');
  });

  test('push 成功 → fallback echo 不打（||短路）', () => {
    const { dir, result } = runWithMockGit({ pushExitCode: 0 });
    dirsToCleanup.push(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('push skipped');
    expect(result.stdout).toContain('AFTER_PUSH');
  });

  test('stderr 被 2>/dev/null 吞（不污染容器日志）', () => {
    const { dir, result } = runWithMockGit({ pushExitCode: 1 });
    dirsToCleanup.push(dir);
    expect(result.stderr).not.toContain('fatal: could not read');
  });
});
