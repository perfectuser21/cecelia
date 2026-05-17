// SPDX-License-Identifier: MIT
// Test for docker/cecelia-runner/entrypoint.sh run_claude tee behavior.
// 目的：保证 Layer 3 spawn-and-interrupt 后 callback body 能拿到 claude stdout，
// 而不是 PR #2845 引入的"永远空字符串"BUG。

import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENTRYPOINT_PATH = path.join(REPO_ROOT, 'docker/cecelia-runner/entrypoint.sh');

function extractRunClaudeFn() {
  const src = readFileSync(ENTRYPOINT_PATH, 'utf8');
  const m = src.match(/^run_claude\(\) \{[\s\S]+?^\}/m);
  if (!m) throw new Error('run_claude() not found in entrypoint.sh');
  return m[0];
}

function runWithMockClaude({ stdoutLines, exitCode, withPromptFile }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'h7-tee-'));

  // mock claude 二进制：把 stdoutLines 打到 stdout 然后 exit
  const mockClaude = path.join(dir, 'claude');
  const echoCmds = stdoutLines.map((l) => `echo ${JSON.stringify(l)}`).join('\n');
  writeFileSync(
    mockClaude,
    `#!/usr/bin/env bash\n${echoCmds}\nexit ${exitCode}\n`,
    'utf8',
  );
  chmodSync(mockClaude, 0o755);

  const promptFile = path.join(dir, 'prompt.txt');
  if (withPromptFile) writeFileSync(promptFile, 'test prompt');

  const stdoutFile = path.join(dir, 'task.stdout');

  const fnBody = extractRunClaudeFn();
  const wrapper = `
set -o pipefail
${fnBody}
MODEL_FLAGS=()
PROMPT_FILE="${promptFile}"
STDOUT_FILE="${stdoutFile}"
run_claude
echo "EXIT_CODE=$?"
`;

  const result = spawnSync('bash', ['-c', wrapper], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
  });

  return { dir, stdoutFile, result };
}

describe('entrypoint.sh run_claude tee STDOUT_FILE', () => {
  const dirsToCleanup = [];
  afterEach(() => {
    while (dirsToCleanup.length) {
      try { rmSync(dirsToCleanup.pop(), { recursive: true, force: true }); } catch {}
    }
  });

  test('writes claude stdout to STDOUT_FILE when PROMPT_FILE exists', () => {
    const { dir, stdoutFile, result } = runWithMockClaude({
      stdoutLines: ['MOCK_LINE_A', 'MOCK_LINE_B'],
      exitCode: 0,
      withPromptFile: true,
    });
    dirsToCleanup.push(dir);
    expect(result.status).toBe(0);
    const content = readFileSync(stdoutFile, 'utf8');
    expect(content).toContain('MOCK_LINE_A');
    expect(content).toContain('MOCK_LINE_B');
    expect(result.stdout).toMatch(/EXIT_CODE=0/);
  });

  test('writes claude stdout to STDOUT_FILE when PROMPT_FILE absent (else branch)', () => {
    const { dir, stdoutFile, result } = runWithMockClaude({
      stdoutLines: ['NO_PROMPT_BRANCH_X'],
      exitCode: 0,
      withPromptFile: false,
    });
    dirsToCleanup.push(dir);
    expect(result.status).toBe(0);
    expect(readFileSync(stdoutFile, 'utf8')).toContain('NO_PROMPT_BRANCH_X');
  });

  test('preserves claude exit code via PIPESTATUS[0] (not swallowed by tee)', () => {
    const { dir, result } = runWithMockClaude({
      stdoutLines: ['out'],
      exitCode: 7,
      withPromptFile: true,
    });
    dirsToCleanup.push(dir);
    expect(result.stdout).toMatch(/EXIT_CODE=7/);
  });
});
