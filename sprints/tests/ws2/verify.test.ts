import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  chmodSync,
} from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const VERIFY = resolve(REPO_ROOT, 'initiatives/b1/scripts/verify.sh');
const ENTRY = resolve(REPO_ROOT, 'initiatives/b1/entry.js');
const CONFIG = resolve(REPO_ROOT, 'initiatives/b1/config/default.json');
const README = resolve(REPO_ROOT, 'initiatives/b1/README.md');

function runVerify() {
  return spawnSync('bash', [VERIFY], { encoding: 'utf8', cwd: REPO_ROOT });
}

describe('Workstream 2 — Verify Script & README [BEHAVIOR]', () => {
  it('exits 0 and prints PASS when scaffold is healthy', () => {
    expect(existsSync(VERIFY)).toBe(true);
    const res = runVerify();
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/\bPASS\b/);
  });

  it('exits non-zero when entry script is replaced with process.exit(7)', () => {
    expect(existsSync(ENTRY)).toBe(true);
    const original = readFileSync(ENTRY, 'utf8');
    writeFileSync(ENTRY, 'process.exit(7);\n');
    try {
      const res = runVerify();
      expect(res.status).not.toBe(0);
      expect(res.status).not.toBeNull();
    } finally {
      writeFileSync(ENTRY, original);
    }
  });

  it('exits non-zero when banner field is removed from default config', () => {
    expect(existsSync(CONFIG)).toBe(true);
    const original = readFileSync(CONFIG, 'utf8');
    writeFileSync(CONFIG, JSON.stringify({ note: 'banner removed for verify failure test' }));
    try {
      const res = runVerify();
      expect(res.status).not.toBe(0);
      expect(res.status).not.toBeNull();
    } finally {
      writeFileSync(CONFIG, original);
    }
  });

  it('prints readable failure when entry file is unreadable, no raw stack frame', () => {
    expect(existsSync(ENTRY)).toBe(true);
    const originalMode = statSync(ENTRY).mode;
    chmodSync(ENTRY, 0o000);
    try {
      const res = runVerify();
      expect(res.status).not.toBe(0);
      expect(res.status).not.toBeNull();
      const out = (res.stdout || '') + (res.stderr || '');
      expect(out).toMatch(/entry|入口|permission|权限|读取/i);
      expect(out).not.toMatch(/at Object\.<anonymous>/);
    } finally {
      chmodSync(ENTRY, originalMode);
    }
  });

  it('README documents both entry and verify run commands as copy-pasteable lines', () => {
    expect(existsSync(README)).toBe(true);
    const content = readFileSync(README, 'utf8');
    expect(content).toContain('node initiatives/b1/entry.js');
    expect(content).toContain('bash initiatives/b1/scripts/verify.sh');
  });
});
