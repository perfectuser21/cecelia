import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// TDD Red: lint 脚本与 fixture 尚不存在 → 抛错 → red
const LINT = 'packages/brain/scripts/lint/lint-terminal-failure-class.mjs';
const FIXTURE = 'sprints/08111600-harness-failure-observability/fixtures/bad-terminal-write.snippet';
const SCANNED = 'packages/brain/src/harness-failure-class.js';

function runLint(): number {
  try {
    execFileSync('node', [LINT], { stdio: 'pipe' });
    return 0;
  } catch (e: any) {
    return e.status ?? 1;
  }
}

describe('机械闸 lint-terminal-failure-class [BEHAVIOR]', () => {
  it('lint 干净树 exit 0', () => {
    expect(fs.existsSync(LINT)).toBe(true);
    expect(runLint()).toBe(0);
  });

  it('lint 命中裸 terminal 写入 exit 1', () => {
    const original = fs.readFileSync(SCANNED, 'utf8');
    try {
      fs.appendFileSync(SCANNED, '\n' + fs.readFileSync(FIXTURE, 'utf8') + '\n');
      expect(runLint()).toBe(1);
    } finally {
      fs.writeFileSync(SCANNED, original);
    }
  });
});
