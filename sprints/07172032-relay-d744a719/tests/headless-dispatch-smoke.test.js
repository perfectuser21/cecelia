// TDD Red — headless-dispatch-smoke
// Sprint: sprints/07172032-relay-d744a719
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../../../../');
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
