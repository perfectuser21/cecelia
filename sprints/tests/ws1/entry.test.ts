import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const ENTRY = resolve(REPO_ROOT, 'initiatives/b1/entry.js');
const CONFIG = resolve(REPO_ROOT, 'initiatives/b1/config/default.json');

function runEntry() {
  return spawnSync('node', [ENTRY], { encoding: 'utf8', cwd: REPO_ROOT });
}

describe('Workstream 1 — Initiative B1 Entry & Default Config [BEHAVIOR]', () => {
  it('exits with code 0 when invoked with no arguments', () => {
    const res = runEntry();
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(0);
  });

  it('prints recognizable Initiative B1 banner to stdout', () => {
    const res = runEntry();
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Initiative B1/);
  });

  it('echoes config.banner field value into stdout on startup', () => {
    expect(existsSync(CONFIG)).toBe(true);
    const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
    expect(typeof config.banner).toBe('string');
    expect(config.banner.length).toBeGreaterThan(0);

    const res = runEntry();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(config.banner);
  });

  it('exits non-zero with readable error when default config file is missing', () => {
    expect(existsSync(CONFIG)).toBe(true);
    const backup = CONFIG + '.bak-test-missing';
    renameSync(CONFIG, backup);
    try {
      const res = runEntry();
      expect(res.status).not.toBe(0);
      expect(res.status).not.toBeNull();
      const out = (res.stdout || '') + (res.stderr || '');
      expect(out).toMatch(/config|配置/i);
    } finally {
      renameSync(backup, CONFIG);
    }
  });

  it('exits non-zero with readable error when banner field is missing from config', () => {
    expect(existsSync(CONFIG)).toBe(true);
    const original = readFileSync(CONFIG, 'utf8');
    writeFileSync(CONFIG, JSON.stringify({ note: 'banner field intentionally removed' }));
    try {
      const res = runEntry();
      expect(res.status).not.toBe(0);
      expect(res.status).not.toBeNull();
      const out = (res.stdout || '') + (res.stderr || '');
      expect(out).toMatch(/banner|配置/i);
    } finally {
      writeFileSync(CONFIG, original);
    }
  });

  it('produces identical exit code and stdout on repeated invocation', () => {
    const r1 = runEntry();
    const r2 = runEntry();
    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);
    expect(r2.stdout).toBe(r1.stdout);
  });
});
