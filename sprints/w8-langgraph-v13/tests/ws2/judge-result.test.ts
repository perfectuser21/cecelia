import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'sprints/w8-langgraph-v13/scripts/judge-result.sh');
const FIX_PASS = resolve(__dirname, 'fixtures/pass');
const FIX_FAIL = resolve(__dirname, 'fixtures/fail');

function makeSandbox(): { sprintDir: string; evidenceDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'w8v13-judge-'));
  const sprintDir = join(root, 'sprint');
  const evidenceDir = join(sprintDir, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  return { sprintDir, evidenceDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('Workstream 2 — judge-result.sh [BEHAVIOR]', () => {
  it('script file exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });

  it('exits non-zero with usage when called with no args', () => {
    const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/usage|Usage|USAGE/);
  });

  it('writes result.md starting with PASS when given pass-fixture evidence', () => {
    const sb = makeSandbox();
    try {
      cpSync(FIX_PASS, sb.evidenceDir, { recursive: true });
      const r = spawnSync(
        'bash',
        [SCRIPT, '00000000-0000-0000-0000-000000000001', sb.evidenceDir, sb.sprintDir],
        { encoding: 'utf8' },
      );
      expect(r.status).toBe(0);
      const result = readFileSync(join(sb.sprintDir, 'result.md'), 'utf8');
      expect(result.split('\n')[0]).toMatch(/^PASS/);
    } finally {
      sb.cleanup();
    }
  });

  it('writes result.md starting with FAIL and generates h12-draft.md when given fail-fixture evidence', () => {
    const sb = makeSandbox();
    try {
      cpSync(FIX_FAIL, sb.evidenceDir, { recursive: true });
      const r = spawnSync(
        'bash',
        [SCRIPT, '00000000-0000-0000-0000-000000000002', sb.evidenceDir, sb.sprintDir],
        { encoding: 'utf8' },
      );
      // FAIL 路径下 judge 仍应正常退出（裁决已写盘），exit code 视实现可为 0 或 1，但产出物必须齐
      const result = readFileSync(join(sb.sprintDir, 'result.md'), 'utf8');
      expect(result.split('\n')[0]).toMatch(/^FAIL/);
      const h12 = readFileSync(join(sb.sprintDir, 'h12-draft.md'), 'utf8');
      expect(h12.length).toBeGreaterThan(0);
    } finally {
      sb.cleanup();
    }
  });
});
