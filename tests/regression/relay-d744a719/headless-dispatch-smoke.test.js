// TDD — headless-dispatch-smoke
// 毕业自 sprints/07172032-relay-d744a719/tests/
// Sprint: sprints/07172032-relay-d744a719
// Task: d744a719-0247-4b15-b91d-882fae1838a5
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 从 tests/regression/relay-d744a719/ 上 3 级到 repo root
const REPO = resolve(import.meta.dirname, '../../../');
const SMOKE_SCRIPT = resolve(REPO, 'packages/brain/scripts/smoke/headless-dispatch-smoke.sh');
const ALLOWLIST = resolve(REPO, 'packages/quality/smoke-allowlist.txt');

describe('[BEHAVIOR-1~6] headless-dispatch-smoke', () => {
  it('[FR1] headless-dispatch-smoke.sh 文件存在', () => {
    expect(existsSync(SMOKE_SCRIPT)).toBe(true);
  });

  it('[FR2] smoke 脚本包含 mode=headless 验证逻辑', () => {
    const content = readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(content).toContain('headless');
  });

  it('[FR3] smoke 脚本包含 CECELIA_HEADLESS 检查', () => {
    const content = readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(content).toContain('CECELIA_HEADLESS');
  });

  it('[FR4] smoke 脚本包含 PPID 或 slot-allocator 检查', () => {
    const content = readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(content.includes('PPID') || content.includes('slot-allocator')).toBe(true);
  });

  it('[FR5] smoke 脚本包含 harness-skill-relay 或 spawnFn/docker 检查', () => {
    const content = readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(content.includes('harness-skill-relay') || content.includes('spawnFn') || content.includes('docker')).toBe(true);
  });

  it('[FR6] headless-dispatch-smoke.sh 已加入 smoke-allowlist.txt', () => {
    const content = readFileSync(ALLOWLIST, 'utf8');
    expect(content).toContain('headless-dispatch-smoke.sh');
  });
});
